'use strict';

var es = require('event-stream');
var fs = require('fs');
var _ = require("lodash");
var vfs = require('vinyl-fs');
var through2 = require('through2');
var gutil = require('gulp-util');
var PugInheritance = require('pug-inheritance');
var PLUGIN_NAME = 'gulp-pug-inheritance';

var createPugInheritance = function(file, options) {
  var pugInheritance = null;
  try {
    pugInheritance = new PugInheritance(file.path, options.basedir, options);
  } catch (e) {
    // prevent multiple errors on the same file
    var alreadyShown;
    if (errors[e.message]) {
      alreadyShown = true;
    }

    clearTimeout(errors[e.message]);
    errors[e.message] = setTimeout(function () {
      delete errors[e.message];
    }, 500); //debounce

    if (alreadyShown) {
      return;
    }

    var err = new gutil.PluginError(PLUGIN_NAME, e);
    stream.emit("error", err);
    return;
  }
  return pugInheritance;
};


function gulpPugInheritance(options) {
  options = options || {};

  var stream;
  var errors = {};
  var files = [];
  var pathToTempInheritance = process.cwd() + '/temp.pugInheritance.json';
  var saveInheritanceToFile = options.saveToFile === false ? false : true;

  function writeStream(currentFile) {
    if (currentFile && currentFile.contents.length) {
      files.push(currentFile);
    }
  }

  function endStream() {
    if (files.length) {
      var pugInheritanceFiles = [];
      var filesPaths = [];
      var inheritance = {};
      var tempInheritance = null;

      options = _.defaults(options, {'basedir': process.cwd()});

      if (saveInheritanceToFile === true) {
        if (fs.existsSync(pathToTempInheritance)) {
          tempInheritance = require(pathToTempInheritance);
        } else {
          fs.writeFileSync(pathToTempInheritance, JSON.stringify({}, null, 2), 'utf-8');
          tempInheritance = require(pathToTempInheritance);
        }
      }


      _.forEach(files, function(file) {

        var cacheKey = file.relative.replace(/\/|\\|\\\\|\-|\.|\:/g, '_');
        var pugInheritance = null;

        if (saveInheritanceToFile === true) {
          if (tempInheritance[cacheKey] === undefined) {
            pugInheritance = createPugInheritance(file, options);
            tempInheritance[cacheKey] = pugInheritance;
            fs.writeFileSync(pathToTempInheritance, JSON.stringify(tempInheritance, null, 2), 'utf-8');
          } else {
            pugInheritance = tempInheritance[cacheKey];
          }
        } else {
          pugInheritance = createPugInheritance(file, options);
        }

        var fullpaths = _.map(pugInheritance.files, function (file) {
          return options.basedir + "/" +  file;
        });

        filesPaths = _.union(filesPaths, fullpaths);

      });

      if(filesPaths.length) {
        vfs.src(filesPaths, {'base': options.basedir})
          .pipe(es.through(
            function (f) {
              stream.emit('data', f);
            },
            function () {
              stream.emit('end');
            }
        ));
      } else {
        stream.emit('end');
      }
    } else {
      stream.emit('end');
    }
  }

  stream = es.through(writeStream, endStream);

  return stream;
}
/*
module.exports = function(options) {
  var stream;
  var gulpPugInheritance = new GulpPugInheritance(options);
  function writeStream (currentFile) {
    if (currentFile && currentFile.contents.length) {
      gulpPugInheritance.files.push(currentFile);
    }
  }
};
*/
module.exports = gulpPugInheritance;
