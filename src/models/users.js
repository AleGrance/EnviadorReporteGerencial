module.exports = (sequelize, DataType) => {
  const Users = sequelize.define("Users", {
    user_id: {
      type: DataType.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    user_name: {
      type: DataType.STRING,
      allowNull: false,
      unique: true,
      validate: {
        notEmpty: {
          msg: "msg: El nombre de usuario no puede estar vacio",
        },
      }
    },
    user_fullname: {
      type: DataType.STRING,
      allowNull: false,
      validate: {
        notEmpty: {
          msg: "msg: El nombre completo no puede estar vacio",
        },
      }
    },
    user_password: {
      type: DataType.STRING,
      allowNull: false,
      validate: {
        notEmpty: {
          msg: "msg: La contraseña no puede estar vacia",
        },
      }
    },
    user_email: {
      type: DataType.STRING,
      allowNull: false,
      unique: true,
      validate: {
        isEmail: {
          msg: "msg: El email no esta correcto",
        },
        notEmpty: true,
      }
    },
  });

  Users.associate = (models) => {
    Users.hasMany(models.Turnos);
  };

  Users.associate = (models) => {
    Users.hasMany(models.Pagos_metrepay);
  };

  Users.associate = (models) => {
    Users.hasMany(models.Historico);
  };

  Users.associate = (models) => {
    Users.belongsTo(models.Roles, {
      foreignKey: {
        name: "role_id",
        allowNull: false,
      },
    });
  };

  return Users;
};
