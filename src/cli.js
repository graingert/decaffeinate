/* @flow */
/* eslint-disable no-process-exit */

import PatchError from './utils/PatchError';
import { convert, modernizeJS } from './index';
import type { Options } from './index';
import { join, dirname, basename, extname } from 'path';
import { stat, readdir, readFile, writeFile } from 'fs';

/**
 * Run the script with the user-supplied arguments.
 */
export default function run(args: Array<string>) {
  let options = parseArguments(args);

  if (options.paths.length) {
    runWithPaths(options.paths, options);
  } else {
    runWithStdio(options);
  }
}

type CLIOptions = {
  paths: Array<string>,
  baseOptions: Options,
  modernizeJS: boolean,
};

function parseArguments(args: Array<string>): CLIOptions {
  let paths = [];
  let baseOptions = {};
  let modernizeJS = false;

  for (let i = 0; i < args.length; i++) {
    let arg = args[i];
    switch (arg) {
      case '-h':
      case '--help':
        usage();
        process.exit(0);
        break;

      case '--modernize-js':
        modernizeJS = true;
        break;

      case '--literate':
        baseOptions.literate = true;
        break;

      case '--keep-commonjs':
        baseOptions.keepCommonJS = true;
        break;

      case '--force-default-export':
        baseOptions.forceDefaultExport = true;
        break;

      case '--safe-import-function-identifiers':
        i++;
        baseOptions.safeImportFunctionIdentifiers = args[i].split(',');
        break;

      case '--prefer-const':
        baseOptions.preferConst = true;
        break;

      case '--loose-default-params':
        baseOptions.looseDefaultParams = true;
        break;

      case '--loose-for-expressions':
        baseOptions.looseForExpressions = true;
        break;

      case '--loose-for-of':
        baseOptions.looseForOf = true;
        break;

      case '--loose-includes':
        baseOptions.looseIncludes = true;
        break;

      case '--loose-comparison-negation':
        baseOptions.looseComparisonNegation = true;
        break;

      case '--allow-invalid-constructors':
        baseOptions.allowInvalidConstructors = true;
        break;

      case '--enable-babel-constructor-workaround':
        baseOptions.enableBabelConstructorWorkaround = true;
        break;

      default:
        if (arg.startsWith('-')) {
          console.error(`Error: unrecognized option '${arg}'`);
          process.exit(1);
        }
        paths.push(arg);
        break;
    }
  }

  return { paths, baseOptions, modernizeJS };
}

/**
 * Run decaffeinate on the given paths, changing them in place.
 */
function runWithPaths(paths: Array<string>, options: CLIOptions, callback: ?((errors: Array<Error>) => void)=null) {
  let errors = [];
  let pending = paths.slice();

  function processPath(path: string) {
    stat(path, (err, info) => {
      if (err) { errors.push(err); }
      else if (info.isDirectory()) {
        processDirectory(path);
      } else {
        processFile(path);
      }
    });
  }

  function processDirectory(path: string) {
    readdir(path, (err, children) => {
      if (err) { errors.push(err); }
      else {
        pending.unshift(
          ...children
            .filter(child => {
              if (options.modernizeJS) {
                return child.endsWith('.js');
              } else {
                return child.endsWith('.coffee') ||
                  child.endsWith('.litcoffee') ||
                  child.endsWith('.coffee.md');
              }
            })
            .map(child => join(path, child))
        );
      }
      processNext();
    });
  }

  function processFile(path: string) {
    let extension = path.endsWith('.coffee.md') ? '.coffee.md' : extname(path);
    let outputPath = join(dirname(path), basename(path, extension)) + '.js';
    console.log(`${path} → ${outputPath}`);
    readFile(path, 'utf8', (err, data) => {
      if (err) {
        errors.push(err);
        processNext();
        return;
      }
      let resultCode = runWithCode(path, data, options);
      writeFile(outputPath, resultCode, err => {
        if (err) { errors.push(err); }
        processNext();
      });
    });
  }

  function processNext() {
    if (pending.length > 0) {
      processPath(pending.shift());
    } else if (callback) {
      callback(errors);
    }
  }

  processNext();
}

function runWithStdio(options: CLIOptions) {
  let data = '';
  process.stdin.on('data', chunk => data += chunk);
  process.stdin.on('end', () => {
    let resultCode = runWithCode('stdin', data, options);
    process.stdout.write(resultCode);
  });
}

/**
 * Run decaffeinate on the given code string and return the resulting code.
 */
function runWithCode(name: string, code: string, options: CLIOptions): string {
  let baseOptions = Object.assign({filename: name}, options.baseOptions);
  try {
    if (options.modernizeJS) {
      return modernizeJS(code, baseOptions).code;
    } else {
      return convert(code, baseOptions).code;
    }
  } catch (err) {
    if (PatchError.detect(err)) {
      console.error(`${name}: ${PatchError.prettyPrint(err)}`);
      process.exit(1);
      throw new Error();
    } else {
      throw err;
    }
  }
}

/**
 * Print usage help.
 */
function usage() {
  let exe = basename(process.argv[1]);
  console.log('%s [OPTIONS] PATH [PATH …]', exe);
  console.log('%s [OPTIONS] < INPUT', exe);
  console.log();
  console.log('Move your CoffeeScript source to JavaScript using modern syntax.');
  console.log();
  console.log('OPTIONS');
  console.log();
  console.log('  -h, --help               Display this help message.');
  console.log('  --modernize-js           Treat the input as JavaScript and only run the');
  console.log('                           JavaScript-to-JavaScript transforms, modifying the file(s)');
  console.log('                           in-place.');
  console.log('  --literate               Treat the input file as Literate CoffeeScript.');
  console.log('  --keep-commonjs          Do not convert require and module.exports to import and export.');
  console.log('  --force-default-export   When converting to export, use a single "export default" rather ');
  console.log('                           than trying to generate named imports where possible.');
  console.log('  --safe-import-function-identifiers');
  console.log('                           Comma-separated list of function names that may safely be in the ');
  console.log('                           import/require section of the file. All other function calls ');
  console.log('                           will disqualify later requires from being converted to imports.');
  console.log('  --prefer-const           Use the const keyword for variables when possible.');
  console.log('  --loose-default-params   Convert CS default params to JS default params.');
  console.log('  --loose-for-expressions  Do not wrap expression loop targets in Array.from.');
  console.log('  --loose-for-of           Do not wrap JS for...of loop targets in Array.from.');
  console.log('  --loose-includes         Do not wrap in Array.from when converting in to includes.');
  console.log('  --loose-comparison-negation');
  console.log('                           Allow unsafe simplifications like `!(a > b)` to `a <= b`.');
  console.log('  --allow-invalid-constructors');
  console.log('                           Don\'t error when constructors use this before super or omit');
  console.log('                           the super call in a subclass.');
  console.log('  --enable-babel-constructor-workaround');
  console.log('                           Use a hacky Babel-specific workaround to allow this before');
  console.log('                           super in constructors. Also works when using TypeScript.');
  console.log();
  console.log('EXAMPLES');
  console.log();
  console.log('  # Convert a .coffee file to a .js file.');
  console.log('  $ decaffeinate index.coffee');
  console.log();
  console.log('  # Pipe an example from the command-line.');
  console.log('  $ echo "a = 1" | decaffeinate');
  console.log();
  console.log('  # On OS X this may come in handy:');
  console.log('  $ pbpaste | decaffeinate | pbcopy');
  console.log();
  console.log('  # Process everything in a directory.');
  console.log('  $ decaffeinate src/');
  console.log();
  console.log('  # Redirect input from a file.');
  console.log('  $ decaffeinate < index.coffee');
}
