module.exports = (sequelize, DataType) => {
  const Reporte_turno = sequelize.define("Reporte_turno", {
    id_reporte_turno: {
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
    
    AGENDADOS: {
      type: DataType.INTEGER,
      allowNull: false,
    },

    ASISTIDOS: {
      type: DataType.INTEGER,
      allowNull: false,
    },

    PROFESIONAL: {
      type: DataType.INTEGER,
      allowNull: false,
    },
  });

  Reporte_turno.associate = (models) => {
    Reporte_turno.belongsTo(models.Users, {
      foreignKey: {
        name: "user_id",
        allowNull: true,
        defaultValue: 1,
      },
    });
  };
  return Reporte_turno;
};
