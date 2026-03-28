"use strict";
const { Model } = require("sequelize");
module.exports = (sequelize, DataTypes) => {
  class Upload extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // ảnh bắt đầu
      Upload.hasMany(models.Command, {
        foreignKey: "start_pic",
        as: "startCommands",
      });

      // ảnh kết thúc
      Upload.hasMany(models.Command, {
        foreignKey: "end_pic",
        as: "endCommands",
      });
    }
  }
  Upload.init(
    { name_img: DataTypes.STRING, path_img: DataTypes.STRING },
    {
      sequelize,
      modelName: "Upload",
    },
  );
  return Upload;
};
