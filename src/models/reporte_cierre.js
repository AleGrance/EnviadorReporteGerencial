module.exports = (sequelize, DataType) => {
  const Reporte_cierre = sequelize.define("Reporte_cierre", {
    id_reporte_cierre: {
      type: DataType.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },

    FECHA: {
      type: DataType.DATEONLY,
      allowNull: false,
    },

    SUCURSAL: {
      type: DataType.STRING,
      allowNull: false,
    },

    CUOTA_SOCIAL: {
      type: DataType.STRING,
      allowNull: false,
    },

    TRATAMIENTO: {
      type: DataType.STRING,
      allowNull: false,
    },

    COBRADOR: {
      type: DataType.STRING,
      allowNull: false,
    },

    VENTA_NUEVA: {
      type: DataType.STRING,
      allowNull: false,
    },

    ONIX: {
      type: DataType.STRING,
      allowNull: false,
    },

    MONTO_TOTAL: {
      type: DataType.STRING,
      allowNull: false,
    },
  });

  Reporte_cierre.associate = (models) => {
    Reporte_cierre.belongsTo(models.Users, {
      foreignKey: {
        name: "user_id",
        allowNull: true,
        defaultValue: 1,
      },
    });
  };
  return Reporte_cierre;
};
