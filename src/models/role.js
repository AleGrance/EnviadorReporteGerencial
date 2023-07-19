module.exports = (sequelize, DataType) => {
  const Roles = sequelize.define("Roles", {
    role_id: {
      type: DataType.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    role_name: {
      type: DataType.STRING,
      allowNull: false,
      unique: true,
      validate: {
        notEmpty: {
          msg: "msg: El nombre del rol no puede estar vacio",
        },
      }
    },
  });

  Roles.associate = (models) => {
    Roles.hasMany(models.Users, {
      foreignKey: {
        name: "role_id",
        allowNull: false,
      },
    });
  };

  return Roles;
};
