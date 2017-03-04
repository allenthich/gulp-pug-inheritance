var es = require('event-stream');
var fs = require('fs');
var path = require('path');
var _ = require("lodash");
var vfs = require('vinyl-fs');
var through2 = require('through2');
var gutil = require('gulp-util');
var PugInheritance = require('pug-inheritance');
var PLUGIN_NAME = 'gulp-pug-inheritance';

var pugLex = require('pug-lexer');
var pugParser = require('pug-parser');
var pugWalk = require('pug-walk');

var GulpPugInheritance = (function() {
  'use strict';

  function GulpPugInheritance(options) {

    this.options    = _.merge(this.DEFAULTS, options);
    this.stream     = undefined;
    this.errors     = {};
    this.files      = [];
    this.filesPaths = [];
    this.firstRun   = false;

    if ( this.options.saveInTempFile === true ) {
      this.tempFile = path.join(process.cwd(), this.options.tempFile);
      this.tempInheritance = this.getTempFile();
    }
  }

  GulpPugInheritance.prototype.DEFAULTS = {
    basedir :         process.cwd(),
    extension:        '.pug',
    skip:             'node_modules',
    saveInTempFile:   false,
    tempFile:         'temp.pugInheritance.json'
  };

  GulpPugInheritance.prototype.getInheritance = function( path ) {
    var inheritance = null;
    try {
      inheritance = new PugInheritance( path, this.options.basedir, this.options );
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
    if ( !fs.existsSync( this.tempFile ) ) {
      fs.writeFileSync(this.tempFile, JSON.stringify({}, null, 2), 'utf-8');
      this.firstRun = true;
    }

    return require( this.tempFile );
  };

  GulpPugInheritance.prototype.setTempKey = function( path ) {
    return path.replace( /\/|\\|\\\\|\-|\.|\:/g, '_' );
  };

  GulpPugInheritance.prototype.getDependencies = function( file, pathToFile ) {
    var _this         = this,
        dependencies  = [],
        fileRelative  = ( typeof file === 'object' ) ? file.relative : file,
        filePath      = ( typeof file === 'object' ) ? file.path : pathToFile,
        contents      = ( fs.existsSync(filePath) ) ? fs.readFileSync( filePath, 'utf8' ) : false,
        dirname       = path.dirname( fileRelative );

    if ( contents === false ) {return;}
    var lex           = pugLex(contents, {
                        filename: fileRelative
                      }),
        parse = pugParser( lex );
    var walk  = pugWalk( parse, function( node ){
      if ( node.type === 'Include' || node.type === 'Extends' ) {
        var pathToDependencie =path.join( dirname, node.file.path );
        if ( _.indexOf( dependencies, pathToDependencie ) === -1 ) {
          dependencies.push( pathToDependencie );
        }
      }
    });
    return dependencies;
  };

  GulpPugInheritance.prototype.updateTempInheritance = function( dependency ) {
    var cacheKey = this.setTempKey( dependency );
    var pathToFile = path.join( process.cwd(), this.options.basedir, path.normalize( dependency ) );
    if ( this.tempInheritance[cacheKey] ) {
      this.tempInheritance[cacheKey] = {};
      this.tempInheritance[cacheKey] = this.getInheritance( pathToFile );
      this.tempInheritance[cacheKey].dependencies = this.getDependencies( dependency, pathToFile );
      this.tempInheritance[cacheKey].file = dependency;
    }
  };

  GulpPugInheritance.prototype.updateDependencies = function( dependencies ) {
    var _this = this;
    if ( dependencies.length > 0 ) {
      _.forEach( dependencies, function( dependency ) {
        _this.updateTempInheritance( dependency );
      });
    }
  };

  GulpPugInheritance.prototype.setTempInheritance = function( file ) {
    var _this = this,
        cacheKey = this.setTempKey( file.relative ),
        inheritance =  this.getInheritance( file.path );

    this.tempInheritance[cacheKey] = {};
    this.tempInheritance[cacheKey] = inheritance;
    this.tempInheritance[cacheKey].dependencies = this.getDependencies( file );
    this.tempInheritance[cacheKey].file = file.relative;

    if ( this.firstRun === false ) {
      this.updateDependencies( this.tempInheritance[cacheKey].dependencies );
    }

    return inheritance;
  };

  GulpPugInheritance.prototype.resolveInheritance = function( file ) {
    var cacheKey = this.setTempKey( file.relative ),
        inheritance = null,
        _this = this,
        date = Date.now(),
        state = null;

    if ( this.options.saveInTempFile === false ) {
      inheritance = this.getInheritance( file.path );
    } else {
      if ( this.tempInheritance[cacheKey]  === undefined ) {
        state = 'NEW';
        inheritance = this.setTempInheritance( file );
      } else {
        state = 'CACHED';
        if ( this.getDependencies( file ).length === this.tempInheritance[cacheKey].dependencies.length ) {
          inheritance = this.tempInheritance[cacheKey];
        } else {
          this.tempInheritance[cacheKey] = undefined;
          inheritance = this.setTempInheritance( file );
        }
      }
    }
    var timeElapsed = (Date.now() - date);
    // console.log('[' + PLUGIN_NAME + '][' + state + '] Get inheritance of: "' + file.relative + '" - ' + timeElapsed + 'ms');

    return inheritance;
  };

  GulpPugInheritance.prototype.writeStream = function( file ) {
    if ( file && file.contents.length ) {
      this.files.push( file );
    }
  };

  GulpPugInheritance.prototype.endStream = function() {
    var _this = this;
    if ( this.files.length ) {

      /*
      if ( this.options.saveInTempFile === true ) {
        if ( this.firstRun === true ) {
          console.log('[' + PLUGIN_NAME + '] Plugin started for the first time. Save inheritances to a tempfile');
        } else {
          console.log('[' + PLUGIN_NAME + '] Plugin already started once. Get inheritances from a tempfile');
        }
      }
      */

      _.forEach( this.files, function( file ) {
        var inheritance = _this.resolveInheritance( file );

        var fullpaths = _.map( inheritance.files, function( file ) {
          return path.join(_this.options.basedir, file);
        });

        _this.filesPaths = _.union(_this.filesPaths, fullpaths);
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

    if ( this.options.saveInTempFile === true ) {
      if ( _.size(this.tempInheritance) > 0 ) {
        _.forEach( this.tempInheritance, function( tempInheritance ) {
          if (tempInheritance !== undefined) {
            var cacheKey = _this.setTempKey( tempInheritance.file );
            var baseDir = path.join( process.cwd(), _this.options.basedir, tempInheritance.file );
            if ( !fs.existsSync( baseDir ) ) {
              _this.updateDependencies( tempInheritance.dependencies );
              _this.tempInheritance[cacheKey] = undefined;
            }
          }
        });
      }

      fs.writeFileSync( this.tempFile, JSON.stringify( this.tempInheritance, null, 2 ), 'utf-8' );
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

module.exports = function(options) {
  var gulpPugInheritance = new GulpPugInheritance(options);
  return gulpPugInheritance.pipeStream();
};
