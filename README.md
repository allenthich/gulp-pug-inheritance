# @allenthich/gulp-pug-inheritance

> Compile pug files with files that have included it.
> 
> Gulp-pug's pug-load should handle included pug files.

Forked from pure180's [gulp-pug-inheritance](https://github.com/pure180/gulp-pug-inheritance).

This version reimplements [pug-inheritance](https://github.com/adammockor/pug-inheritance)'s O(n<sup>2</sup>) dependency traversal by storing dependencies as a directed graph for O(v) lookup performance.

## Installation

```shell
$ npm install @allenthich/gulp-pug-inheritance --save-dev
```

## Usage
This example highlights processing changed source files and compiling their affected parent dependencies. This is helpful when pug compilation is used in a gulp watch task and only one pug source file hass changed. The plugin on `firstCompile` creates a directed graph of dependencies based on the provided `basedir` directory. It is important to note that dependencies are processed and compiled bottom-up from the changed pug file to their parent dependencies. This allows caching in later steps of the pipeline e.g. `gulp-pug`, `pug-load`.


```js
'use strict';
var gulp = require('gulp');
var pugInheritance = require('gulp-pug-inheritance');
var pug = require('gulp-pug');
var changed = require('gulp-changed');
var gulpif = require('gulp-if');
var through2 = require('through2');

// Pug source file modified timestamps
var pugSrcModifiedTs = {}
var pugBaseDir = path.resolve(process.cwd(), '/src/')
var firstCompile = true

/**
 * Compare file in stream against cached timestamp
 * @override
 * @param {Stream} stream
 * @param {Vinyl} streamingFile
 */
async function compareLastModifiedTime (stream, streamingFile) {
  var filePath = path.join(pugBaseDir, streamingFile.relative)
  var cachedTs = pugSrcModifiedTs[filePath]

  if (streamingFile.stat && Math.floor(streamingFile.stat.mtimeMs) > Math.floor(cachedTs)) {
    console.log('Detected modified file: ', filePath)
    stream.push(streamingFile);
  }
}

/**
 * Store modified timestamps to determine whether a file has changed
 */
function cacheModifiedTimestamp () {
  return through2.obj(function (file, enc, cb) {
    var filePath = path.join(pugBaseDir, file.relative)

    // Get latest timestamp from file in stream
    var latestModifiedFileTs = file.stat && Math.floor(file.stat.mtimeMs)
    pugSrcModifiedTs[filePath] = latestModifiedFileTs

    cb(null, file)
  })
}

gulp.task('pug', function() {
    return gulp.src('src/**/*.pug')

        // Process all files on the first compile, otherwise process changed source files
        .pipe(gulpif(!firstCompile, changed('DEST_NOT_REQ', { extension: '.pug', hasChanged: compareLastModifiedTime })))

        // Track source file changes
        .pipe(cacheModifiedTimestamp())

        // For eligible files in the stream, find files that depend on the files that have changed
        .pipe(pugInheritance({ basedir: 'src', skip: 'node_modules' }))

        // Process pug files that have changed
        .pipe(pug())

        // Save HTML
        .pipe(gulp.dest('dist'));
});
```

```
/src/layout.pug
/src/sub-layout1.pug
/src/sub-layout2.pug
/src/mixins/article.pug
/src/mixins/table.pug
/dist/
```
