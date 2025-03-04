// Module Scope
const mongoose = require('mongoose');
const extend = require('extend');

let counterSchema;
let IdentityCounter;

// Initialize plugin by creating counter collection in database.
exports.initialize = function (connection) {
  try {
    IdentityCounter = connection.model('IdentityCounter');
  } catch (ex) {
    if (ex.name === 'MissingSchemaError') {
      // Create new counter schema.
      counterSchema = new mongoose.Schema({
        model: { type: String, required: true },
        field: { type: String, required: true },
        count: { type: Number, default: 0 },
      });

      // Create a unique index using the "field" and "model" fields.
      counterSchema.index({ field: 1, model: 1 }, { unique: true, required: true, index: -1 });

      // Create model using new schema.
      IdentityCounter = connection.model('IdentityCounter', counterSchema);
    } else {
      throw ex;
    }
  }
};

// The function to use when invoking the plugin on a custom schema.
exports.plugin = function (schema, options) {
  if (!counterSchema || !IdentityCounter) {
    throw new Error("mongoose-auto-increment has not been initialized");
  }

  // Default settings and plugin scope variables.
  const settings = {
    model: null,
    field: '_id',
    startAt: 0,
    incrementBy: 1,
    unique: true,
  };

  let ready = false;

  if (typeof options === 'string') {
    settings.model = options;
  } else if (typeof options === 'object') {
    extend(settings, options);
  }

  if (!settings.model) {
    throw new Error("model must be set");
  }

  const fields = {};
  fields[settings.field] = { type: Number, required: true };

  if (settings.field !== '_id') {
    fields[settings.field].unique = settings.unique;
  }

  schema.add(fields);

  // Find the counter for this model and the relevant field.
  IdentityCounter.findOne({ model: settings.model, field: settings.field })
    .then((counter) => {
      if (!counter) {
        return new IdentityCounter({
          model: settings.model,
          field: settings.field,
          count: settings.startAt - settings.incrementBy,
        }).save();
      }
    })
    .then(() => {
      ready = true;
    })
    .catch((err) => {
      console.error("Error initializing counter:", err);
    });

  // Declare a function to get the next counter for the model/schema.
  const nextCount = function (callback) {
    IdentityCounter.findOne({ model: settings.model, field: settings.field })
      .then((counter) => {
        callback(null, counter ? counter.count + settings.incrementBy : settings.startAt);
      })
      .catch((err) => callback(err));
  };

  schema.method('nextCount', nextCount);
  schema.static('nextCount', nextCount);

  // Declare a function to reset counter at the start value - increment value.
  const resetCount = function (callback) {
    IdentityCounter.findOneAndUpdate(
      { model: settings.model, field: settings.field },
      { count: settings.startAt - settings.incrementBy },
      { new: true }
    )
      .then(() => callback(null, settings.startAt))
      .catch((err) => callback(err));
  };

  schema.method('resetCount', resetCount);
  schema.static('resetCount', resetCount);

  // Every time documents in this schema are saved, run this logic.
  schema.pre('save', function (next) {
    const doc = this;

    if (doc.isNew) {
      (function save() {
        if (ready) {
          if (typeof doc[settings.field] === 'number') {
            IdentityCounter.findOneAndUpdate(
              { model: settings.model, field: settings.field, count: { $lt: doc[settings.field] } },
              { count: doc[settings.field] }
            )
              .then(() => next())
              .catch((err) => next(err));
          } else {
            IdentityCounter.findOneAndUpdate(
              { model: settings.model, field: settings.field },
              { $inc: { count: settings.incrementBy } },
              { new: true }
            )
              .then((updatedIdentityCounter) => {
                doc[settings.field] = updatedIdentityCounter.count;
                next();
              })
              .catch((err) => next(err));
          }
        } else {
          setTimeout(save, 5);
        }
      })();
    } else {
      next();
    }
  });
};