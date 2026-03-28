"use strict";
const { Model } = require("sequelize");
module.exports = (sequelize, DataTypes) => {
  class Command extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      Command.belongsTo(models.Upload, {
        foreignKey: "start_pic",
        as: "startImage",
      });

      Command.belongsTo(models.Upload, {
        foreignKey: "end_pic",
        as: "endImage",
      });
    }
  }
  Command.init(
    {
      prompt: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      start_pic: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      end_pic: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "Command",
    },
  );
  return Command;
};
