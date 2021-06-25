// TODO: Test for cyclic dependencies
'use strict';

var es = require('event-stream');
var _ = require("lodash");
var vfs = require('vinyl-fs');
var fs = require('fs');
var DirectedGraph = require('@datastructures-js/graph').DirectedGraph;
var pugLex = require('pug-lexer');
var nodePath = require('path');

/**
 * Top-down directed dependency graph for downward traversal to child dependencies
 */
var downwardDependencyGraph = new DirectedGraph();

/**
 * Bottom-up directed dependency graph for upward traversal to parent dependencies
 */
var upwardDependencyGraph = new DirectedGraph();

/**
 * List of all file paths streamed through gulp pipe
 */
var projectPugFilePaths = []

/**
 * Flag to enable logging
 */
var DEBUG = true

function info () {
  if (DEBUG) console.log(arguments)
}

/**
 * List of pug-lexer overrides to allow in-place filtering for extends and include statements
 */
var pugLexerOverrides = {
  /**
   * Override advance function to only filter for extends/includes
   * @override
   */
  advance: function (lexer) {
    while (lexer.input) {
      // Consume comments that may have contain "extends/include" keywords
      if (lexer.input && lexer.callLexerFunction('comment')) {
        continue
      }

      // Valid extends/include may have trailing space, returns, and new lines
      var validInheritanceStatement = /^(extends|include)\s([^\s]+)((\\r\\n|\\r|\\n|\r|\n|\s+))/i.test(lexer.input)
      if (lexer.input && !validInheritanceStatement) {
        // Forward reading cursor
        lexer.consume(1)
      } else if (lexer.callLexerFunction('extends') || lexer.callLexerFunction('include')) {
        // Tokenization occurs in callLexerFunction
        continue
      }
    }

    // Signal lexing is finished
    lexer.ended = true
    return true
  },
  /**
   * Override to exclude comment tokens but still recognize and consume them
   * @override
   */
  comment: function (lexer) {
    var captures
    if ((captures = /^\/\/(-)?([^\n]*)/.exec(lexer.input)) !== null) {
      lexer.consume(captures[0].length);
      lexer.callLexerFunction('pipelessText');
      return true;
    }
  },
  /**
   * Override to exclude pipeless text tokens but still recognize and consume them
   * @override
   */
  pipelessText: function pipelessText (lexer, indents) {
    while (lexer.callLexerFunction('blank'));

    var captures = lexer.scanIndentation();

    indents = indents || (captures && captures[1].length);
    if (indents > lexer.indentStack[0]) {
      var tokens = [];
      var isMatch;
      // Index in lexer.input. Can't use lexer.consume because we might need to retry lexing the block.
      var stringPtr = 0;
      do {
        // text has `\n` as a prefix
        var i = lexer.input.substr(stringPtr + 1).indexOf('\n');
        if (i === -1) i = lexer.input.length - stringPtr - 1;
        var str = lexer.input.substr(stringPtr + 1, i);
        var lineCaptures = lexer.indentRe.exec('\n' + str);
        var lineIndents = lineCaptures && lineCaptures[1].length;
        isMatch = lineIndents >= indents || !str.trim();
        if (isMatch) {
          // consume test along with `\n` prefix if match
          stringPtr += str.length + 1;
          tokens.push(str.substr(indents));
        } else if (lineIndents > lexer.indentStack[0]) {
          return pipelessText.call(lexer, lexer, lineCaptures[1].length);
        }
      } while ((lexer.input.length - stringPtr) && isMatch);
      lexer.consume(stringPtr);

      return true;
    }
  }
}

/**
 * Filters a pug file for extends, include, and path statements into tokens
 * @param {String} path Path of file we wish to lexically analyze
 * @returns Array of pug extends/includes tokens each successively followed by a path object
 * @link https://github.com/pugjs/pug-lexer/ for examples of pug tokens
 */
 function getPugInheritanceTokens (path) {
  if (!path) {
    // info('No path provided for inheritance token read')
    return []
  }

  var pugContentStr = fs.readFileSync(path, 'utf8');
  if (!pugContentStr) {
    return []
  }
  
  /**
  * Override to store the file path instead of file name
  * @override
  */
  function pugLexerPathOverride (lexer) {
    var tok = lexer.scanEndOfLine(/^ ([^\n]+)/, 'path');
    if (tok && (tok.val = tok.val.trim())) {
      // Set file path
      tok.val = nodePath.resolve(nodePath.dirname(path), tok.val)
      lexer.tokens.push(tok);
      return true;
    }
  }

  var fileName = path.split('/pug/').pop()

  // Utilize tokenization overrides to filter for extends, include, and path
  return pugLex(pugContentStr, {
    filename: fileName,
    plugins: [
      {
        advance: pugLexerOverrides.advance,
        path: pugLexerPathOverride,
        comment: pugLexerOverrides.comment,
        pipelessText: pugLexerOverrides.pipelessText
      }
    ]
  })
}

/**
 * Process pug tokens into 'extends' and 'includes' lists
 * @param {Array<Object>} pugTokens Ordered list of pug tokens consisting of 'extends', 'include', and 'path' types
 * @param {String} filePath Path of file currently looked at
 * @returns Object containing 'path' with 'extends' and 'includes' mapped to an array of file paths
 * @link https://github.com/pugjs/pug-lexer/ for examples of pug tokens
 */
function aggregateInheritanceTypes (pugTokens, filePath) {
  var aggregate = { path: filePath, extends: [], includes: [] }
  for (var i = 0; i < pugTokens.length; i += 2) {
    var dependencyFilePath = ''
    var inheritanceType = pugTokens[i].type === 'include' ? 'includes' : pugTokens[i].type

    // Path tokens are expected to follow 'extends' and 'include' types
    var pathNode = pugTokens[i + 1]
    if (pathNode.type === 'path') {
      // Add pug extension if needed
      dependencyFilePath = /\.pug/.test(pathNode.val) ? pathNode.val : pathNode.val + '.pug'
    }

    // Only push pug paths that exist within the project
    if (dependencyFilePath && projectPugFilePaths.indexOf(dependencyFilePath) !== -1) {
      aggregate[inheritanceType].push(dependencyFilePath)
    }
  }
  return aggregate
}

/**
 * Creates a directed edge from srcPath to destPath for the provided graph
 * @param {String} srcPath File path
 * @param {String} destPath File path
 * @param {DirectedGraph} graph Reference to graph
 */
function addEdgeToGraph (srcPath, destPath, graph) {
  if (srcPath && destPath && graph) {
    if (!graph.hasEdge(srcPath, destPath)) {
      // Ensure both vertices exist
      graph.addVertex(srcPath, null)
      graph.addVertex(destPath, null)
      graph.addEdge(srcPath, destPath, 1)
    }
  }
}

/**
 * Update downward directed dependency graph by adding new edges for the passed pug file 
 * @param {Object} pugFile 
 * @param {String} pugFile.path 
 * @param {Array<String>} pugFile.extends List of file paths
 * @param {Array<String>} pugFile.includes List of file paths
 */
function addEdgesToDownwardDependencyGraph (pugFile) {
  if (pugFile && pugFile.path && pugFile.includes && pugFile.extends) {
    var currentFilePath = pugFile.path
    // Add extends and includes as edges into dependency graph

    // Parent file to current dependency
    _.forEach(pugFile.extends, function (parentPath) {
      addEdgeToGraph(parentPath, currentFilePath, downwardDependencyGraph)
    })
    // Current file to child dependency
    _.forEach(pugFile.includes, function (childPath) {
      addEdgeToGraph(currentFilePath, childPath, downwardDependencyGraph)
    })
  }
}

/**
 * Update upward directed dependency graph by adding new edges for the passed pug file 
 * @param {Object} pugFile 
 * @param {String} pugFile.path 
 * @param {Array<String>} pugFile.extends List of file paths
 * @param {Array<String>} pugFile.includes List of file paths
 */
function addEdgesToUpwardDependencyGraph (pugFile) {
  if (pugFile && pugFile.path && pugFile.includes && pugFile.extends) {
    var currentFilePath = pugFile.path
    // Add extends and includes as edges into dependency graph

    // Current file to parent dependency
    _.forEach(pugFile.extends, function (parentPath) {
      addEdgeToGraph(currentFilePath, parentPath, upwardDependencyGraph)
    })
    // Child dependency to current file
    _.forEach(pugFile.includes, function (childPath) {
      addEdgeToGraph(childPath, currentFilePath, upwardDependencyGraph)
    })
  }
}

/**
 * Main task for processing files that extends/includes 
 * @link https://www.npmjs.com/package/gulp-pug-inheritance
 * @param {Object} options
 * @param {String} options.basedir File path of root directory for pug files to search
 */
function gulpPugInheritance (options) {
  options = options || {}
  options = _.defaults(options, { basedir: process.cwd() })
  var projectPugBaseDirectory = options.basedir

  var stream
  // TODO: Investigate potential areas of failure
  // var errors = {}
  var files = []

  /**
   * Create list of all files passing through the gulp pipeline
   */
  function writeStream (currentFile) {
    if (currentFile && currentFile.contents.length) {
      files.push(currentFile)
    }
  }

  /**
   * Updates global list of pug files passing through stream
   */
  function updateProjectPugPaths () {
    projectPugFilePaths = _.reduce(files, function (names, file) {
      var filename = nodePath.join(projectPugBaseDirectory, file.relative);
      if (projectPugFilePaths.indexOf(filename) === -1) {
        names.push(filename)
      }
      return names
    }, projectPugFilePaths)
  }

  /**
   * Process files passing through gulp pipeline
   */
  function endStream () {
    if (files.length) {
      // Keep track of pug file names to check against
      updateProjectPugPaths()

      // Iterate through all files to generate a high-level dependency graph
      _.forEach(files, function (file) {
        var currentFilePath = file.path

        // Process pug file for inheritance
        var pugInheritanceTokens = getPugInheritanceTokens(currentFilePath)

        if (pugInheritanceTokens.length) {
          var pugFileInheritance = aggregateInheritanceTypes(pugInheritanceTokens, currentFilePath)

          // Add inheritance to high-level dependency graph
          // addEdgesToDownwardDependencyGraph(pugFileInheritance)
          addEdgesToUpwardDependencyGraph(pugFileInheritance)
        } else {
          // Add unconnected vertex to dependency graph
          // downwardDependencyGraph.addVertex(currentFilePath, null)
          upwardDependencyGraph.addVertex(currentFilePath, null)

          if (DEBUG) {
            // info('No pug inheritance tokens found for:', currentFilePath)
          }
        }
      })

      // Get files that extend from file and files that are included
      // Have to climb up tree
      var dependencies = []

      // Iterate over each file to obtain dependency path for a specific file
      _.forEach(files, function (file) {
        var currentFilePath = file.path

        // GULP-PUG/PUG-LOAD SHOULD HANDLE LOWER DEPENDENCY INCLUDES DURING COMPILATION

        // Get lower dependencies
        // downwardDependencyGraph.traverseBfs(currentFilePath, function (dependencyPath) {
        //   // info(`${dependencyPath}: ${value}`)
        //   // Avoid duplicates
        //   if (dependencies.indexOf(dependencyPath) === -1) {
        //     dependencies.push(dependencyPath)
        //   }
        // })

        // Get higher dependencies
        upwardDependencyGraph.traverseBfs(currentFilePath, function (dependencyPath) {
          // info(`${dependencyPath}: ${value}`)
          // Avoid duplicates
          if (dependencies.indexOf(dependencyPath) === -1) {
            // Add at beginning of array
            dependencies.unshift(dependencyPath)
          }
        })

        // info('currentFilePath:', currentFilePath)
      })

      // Reverse order of compilation so that the changed file can be cache on pug-load level
      _.reverse(dependencies)

      // info('dependencies:', dependencies)

      // Pipe dependency files into stream
      if (dependencies.length) {
        vfs.src(dependencies)
          .pipe(es.through(
            function (f) {
              stream.emit('data', f)
            },
            function () {
              stream.emit('end')
            }
          ))
      } else {
        stream.emit('end')
      }
    } else {
      stream.emit('end')
    }
  }

  /**
   * Forward streamed files
   */
  stream = es.through(writeStream, endStream)

  return stream
};

module.exports = gulpPugInheritance
