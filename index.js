var es = require('event-stream');
var fs = require('fs');
var path = require('path');
var _ = require("lodash");
var vfs = require('vinyl-fs');
var through2 = require('through2');
var gutil = require('gulp-util');
var PugInheritance = require('pug-inheritance');
var PLUGIN_NAME = 'gulp-pug-inheritance';

var GulpPugInheritance = (function() {
  'use strict';

  function GulpPugInheritance(options) {

    this.options    = _.merge(this.DEFAULTS, options);
    this.stream     = undefined;
    this.errors     = {};
    this.files      = [];
    this.filesPaths = [];

    if ( this.options.saveInTempFile === true ) {
      this.tempFile = path.join(process.cwd(), this.options.tempFile);
      this.tempInheritance = this.getTempFile();
    }
  }

  GulpPugInheritance.prototype.DEFAULTS = {
    basedir :         process.cwd(),
    saveInTempFile:   true,
    tempFile:         'temp.pugInheritance.json'
  };

  GulpPugInheritance.prototype.getInheritance = function( file ) {
    var inheritance = null;
    try {
      inheritance = new PugInheritance( file.path, this.options.basedir, this.options );
    } catch ( error ) {
      this.throwError( error );
      return;
    }
    return inheritance;
  };

  GulpPugInheritance.prototype.throwError = function( error ) {
    var alreadyShown,
        _this = this;
    if ( this.errors[error.message] ) {
      alreadyShown = true;
    }

    clearTimeout( this.errors[error.message] );
    this.errors[error.message] = setTimeout( function() {
      delete _this.errors[error.message];
    }, 500 ); //debounce

    if ( alreadyShown ) {
      return;
    }

    var err = new gutil.PluginError( PLUGIN_NAME, error );
    this.stream.emit( "error", err );
  };

  GulpPugInheritance.prototype.getTempFile = function() {
    try {
      fs.existsSync( this.tempFile );
    } catch ( error ) {
      this.throwError( error );
      return;
    }
    return require( this.tempFile );
  };

  GulpPugInheritance.prototype.setTempKey = function( file ) {
    return file.relative.replace( /\/|\\|\\\\|\-|\.|\:/g, '_' );
  };

  GulpPugInheritance.prototype.setTempInheritance = function( file ) {
    var cacheKey = this.setTempKey( file ),
        inheritance = null;

    inheritance = this.getInheritance( file );
    this.tempInheritance[cacheKey] = inheritance;
    fs.writeFileSync( this.tempFile, JSON.stringify(this.tempInheritance, null, 2), 'utf-8' );

    return inheritance;
  };

  GulpPugInheritance.prototype.writeStream = function( file ) {
    if ( file && file.contents.length ) {
      this.files.push( file );
    }
  };

  GulpPugInheritance.prototype.iterator = function( file ) {
    var cacheKey = this.setTempKey( file ),
        inheritance = null,
        _this = this;

    if ( this.options.saveInTempFile === false ) {
      inheritance = this.getInheritance( file );
    } else {
      if ( this.tempInheritance[cacheKey]  === undefined ) {
        inheritance = this.setTempInheritance( file );
      } else {
        inheritance = this.tempInheritance[cacheKey];
      }
    }

    var fullpaths = _.map( inheritance.files, function( file ) {
      return _this.options.basedir + "/" + file;
    });

    this.filesPaths = _.union(this.filesPaths, fullpaths);
  };

  GulpPugInheritance.prototype.endStream = function() {
    if ( this.files.length ) {
      var _this = this;

      _.forEach( this.files, function( file ) {
        _this.iterator( file );
      });

      if ( this.filesPaths.length ) {
          vfs.src( this.filesPaths, {
            'base': this.options.basedir
          }).pipe( es.through(
            function(f) {
              _this.stream.emit('data', f);
            },
            function() {
              _this.stream.emit('end');
            }
          ));
      } else {
        this.stream.emit('end');
      }

    } else {
      this.stream.emit('end');
    }
  };

  GulpPugInheritance.prototype.pipeStream = function() {
    var _this = this;
    function writeStream (file) {
      _this.writeStream(file);
    }
    function endStream () {
      _this.endStream();
    }
    this.stream = es.through( writeStream, endStream ) ;
    return this.stream ;
  };

  return GulpPugInheritance;
})();



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
