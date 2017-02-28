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
    if ( !fs.existsSync( this.tempFile ) ) {
      fs.writeFileSync(this.tempFile, JSON.stringify({}, null, 2), 'utf-8');
      this.firstRun = true;
    }

    return require( this.tempFile );
  };

  GulpPugInheritance.prototype.setTempKey = function( file ) {
    return file.relative.replace( /\/|\\|\\\\|\-|\.|\:/g, '_' );
  };

  GulpPugInheritance.prototype.getDependencies = function( file ) {
    var dependencies = [],
        contents = fs.readFileSync(file.path, 'utf8'),
        lex = pugLex(contents, {
          filename: file.relative
        });

    var parse = pugParser(lex);
    var walk  = pugWalk(parse, function(node){

      if ( node.type === 'Include' || node.type === 'Extends' ) {
        if ( _.indexOf( dependencies, node.file.path ) === -1 ) {
          dependencies.push( node.file.path );
        }
      }
    });
    return dependencies;
  };

  GulpPugInheritance.prototype.setTempInheritance = function( file ) {
    var cacheKey = this.setTempKey( file ),
        inheritance = null;

    inheritance = this.getInheritance( file );
    this.tempInheritance[cacheKey] = inheritance;
    this.tempInheritance[cacheKey].dependencies = this.getDependencies(file);
    fs.writeFileSync( this.tempFile, JSON.stringify(this.tempInheritance, null, 2), 'utf-8' );

    if ( this.firstRun === false ) {
    }

    return inheritance;
  };

  GulpPugInheritance.prototype.resolveInheritance = function( file ) {
    var cacheKey = this.setTempKey( file ),
        inheritance = null,
        _this = this,
        date = Date.now(),
        state = null;

    if ( this.options.saveInTempFile === false ) {
      inheritance = this.getInheritance( file );
    } else {
      if ( this.tempInheritance[cacheKey]  === undefined ) {
        state = 'NEW';
        inheritance = this.setTempInheritance( file );
      } else {
        inheritance = this.tempInheritance[cacheKey];
        state = 'CACHED';
      }
    }
    var timeElapsed = (Date.now() - date);
    console.log('[' + PLUGIN_NAME + '][' + state + '] Get inheritance of: "' + file.relative + '" - ' + timeElapsed + 'ms');

    return inheritance;
  };

  GulpPugInheritance.prototype.writeStream = function( file ) {
    if ( file && file.contents.length ) {
      this.files.push( file );
    }
  };

  GulpPugInheritance.prototype.endStream = function() {
    if ( this.files.length ) {
      var _this = this;

      if ( this.options.saveInTempFile === true ) {
        if ( this.firstRun === true ) {
          console.log('[' + PLUGIN_NAME + '] Plugin started for the first time. Save inheritances to a tempfile');
        } else {
          console.log('[' + PLUGIN_NAME + '] Plugin already started once. Get inheritances from a tempfile');
        }
      }

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
