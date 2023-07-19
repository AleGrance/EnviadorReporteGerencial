import Sequelize from "sequelize";
import fs from "fs";
import path from "path";

let db = null;

module.exports = (app) => {
  const config = app.libs.config; //Info de la conexion a la db del archivo config.js
  //console.log(config);

  if (!db) {
    const sequelize = new Sequelize(
      config.database,
      config.username,
      config.password,
      config.params
    );

    db = {
      sequelize,
      Sequelize,
      models: {},
    };

    const dir = path.join(__dirname, "/models");
    // Lee el directorio y reorre cada archivo del mismo directorio o sea dir
    fs.readdirSync(dir).forEach((filename) => {
      const modelDir = path.join(dir, filename);
      const model = require(modelDir)(sequelize, Sequelize.DataTypes);
      db.models[model.name] = model;
    });

    Object.keys(db.models).forEach((key) => {
      if (db.models[key].hasOwnProperty("associate")) {
        db.models[key].associate(db.models);
      }
    });
  }

  return db;
};
