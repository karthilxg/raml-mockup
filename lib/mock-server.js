'use strict';

var jsonfaker = require('json-schema-faker'),
    raml_parser = require('raml-parser'),
    refaker = require('refaker');

var _ = require('lodash'),
    path = require('path'),
    express = require('express'),
    cors = require('cors');

var extract = require('./util/extract');

module.exports = function(params, callback) {
  if (!params.directory) {
    params.directory = path.dirname(params.raml);
  }

  if (!params.port) {
    params.port = process.env.PORT || 3000;
  }

  if (params.formats) {
    try {
      jsonfaker.format(require(path.resolve(params.formats)));
    } catch (e) {
      return callback(e);
    }
  }

  function log() {
    if (!params.silent && typeof params.log === 'function') {
      params.log(Array.prototype.slice.call(arguments).join(''));
    }
  }

  raml_parser.loadFile(params.raml).then(function(data) {
    try {
      var tmp = [],
          api = extract(data);

      params.schemas = [];

      var push = function (schema) {
        var json = JSON.stringify(_.omit(schema, '$offset'));

        if (tmp.indexOf(json) === -1) {
          params.schemas.push(schema);
          tmp.push(json);
        }
      };

      _.each(api.schemas, push);

      _.each(data.schemas, function(obj) {
        _.each(_.map(_.values(obj), JSON.parse), push);
      });

      refaker(params, function(err, refs, schemas) {
        if (err) {
          return callback(err);
        }

        var app = express(),
            base = 'http://localhost:' + params.port;

        app.use(cors());

        _.each(schemas, function(schema) {
          api.schemas[schema.$offset] = schema;
          delete api.schemas[schema.$offset].$offset;
        });

        log('Endpoint:\n  <yellow>', base, '</yellow>\n');
        log('Resources:\n');

        _.each(api.resources, function(resource, path) {
          var route = path.replace(/\{(\w+)\}/g, ':$1');

          log('  <green>', route, '</green>\n');

          _.each(resource, function(responses, method) {
            var keys = params.statuses ? params.statuses.split(',') : Object.keys(responses);

            log('    <cyan:8>' + method.toUpperCase() + '</cyan> -> ' + (keys.join(', ')) + '\n');

            app.route(route)[method](function(req, res) {
              res.setHeader('Content-Type', 'application/json');
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.setHeader('Access-Control-Allow-Methods', '*');
              res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Content-Length');
              res.setHeader('Access-Control-Expose-Headers', 'Accept-Ranges, Content-Encoding, Content-Length, Content-Range');

              var reqStatus = req.query._statusCode || _.sample(keys),
                  reqExample = req.query._forceExample === 'true' || params.forceExample;
              try {
                if (keys.indexOf(reqStatus) === -1) {
                  throw new Error('missing response for ' + req.url + ' (' + reqStatus + ')');
                }

                var sample = reqExample ? responses[reqStatus].example : false;

                if (!reqExample) {
                  sample = jsonfaker(api.schemas[responses[reqStatus].schema], refs);
                } else if (!sample) {
                  throw new Error('missing example for ' + req.url + ' (' + reqStatus + ')');
                }

                res.statusCode = reqStatus;
                res.json(sample);
              } catch (e) {
                res.statusCode = 500;
                res.json({ error: e.message });
              }

              log('  <yellow>', req.url, '</yellow>\n');
              log('    <cyan:8>', req.method, '</cyan> -> ', res.statusCode, '\n');
            });
          });
        });

        log('\n');

        app.use(function(req, res) {
          res.statusCode = 500;
          res.json({ error: 'Missing resource for ' + req.url });
        });

        app.listen(params.port, function() {
          callback(null, this.close.bind(this));
        });
      });
    } catch (e) {
      callback(e.message || e);
    }
  }, callback);
};
