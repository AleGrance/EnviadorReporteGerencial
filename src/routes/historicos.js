const cron = require("node-cron");
const { Op } = require("sequelize");

module.exports = (app) => {
  const Historicos = app.db.models.Historicos;
  const Tickets = app.db.models.Tickets;

  let historicoObj = {
    fecha: "",
    cant_enviados: 0,
    cant_no_enviados: 0,
    user_id: 1,
  };


  // Ejecutar la funcion a las 20:00 de Lunes(1) a Sabados (6)
  // cron.schedule("20 20 * * 1-6", () => {
  //   let hoyAhora = new Date();
  //   let diaHoy = hoyAhora.toString().slice(0, 3);
  //   let fullHoraAhora = hoyAhora.toString().slice(16, 21);

  //   console.log("Hoy es:", diaHoy, "la hora es:", fullHoraAhora);
  //   console.log("CRON: Se almacena el historico de los tickets enviados hoy");
  //   cantidadEnviados();
  // });

  async function cantidadEnviados() {
    // Fecha de hoy 2022-02-30
    let fechaHoy = new Date().toISOString().slice(0, 10);
    // Se resta un DIA porque se ejecuta a las 20:30 y ???? esta tomando la hora + 04:00
    // Faltaria ver porque y o corregir para que tome la hora local
    let diaRestado = parseInt(fechaHoy.slice(8)) - 1;
    let fechaFormated = fechaHoy.slice(0, 8) + diaRestado.toString();

    // La fecha tomada concat con el dia restado
    historicoObj.fecha = fechaFormated;

    historicoObj.cant_enviados = await Tickets.count({
      where: {
        [Op.and]: [
          { estado_envio: 1 },
          {
            updatedAt: {
              [Op.between]: [
                fechaFormated + " 00:00:00",
                fechaFormated + " 23:59:59",
              ],
            },
          },
        ],
      },
    });

    historicoObj.cant_no_enviados = await Tickets.count({
      where: {
        [Op.and]: [
          { estado_envio: { [Op.ne]: 1 } },
          {
            updatedAt: {
              [Op.between]: [
                fechaFormated + " 00:00:00",
                fechaFormated + " 23:59:59",
              ],
            },
          },
        ],
      },
    });

    console.log(historicoObj);

    Historicos.create(historicoObj)
      .then((result) => {
        console.log("Se inserto la cantidad de envios de hoy en historico!");
      })
      //.catch((error) => console.log(error.detail));
      .catch((error) => console.log(error.message));
  }


  /**
   *
   *  METODOS
   *
   */

  app.route("/historicos").get((req, res) => {
    Historicos.findAll()
      .then((result) => res.json(result))
      .catch((error) => {
        res.status(402).json({
          msg: error.menssage,
        });
      });
  });

  // Historicos por rango de fecha
  app.route("/historicosFecha").post((req, res) => {
    let fechaHoy = new Date().toISOString().slice(0, 10);
    let { fecha_desde, fecha_hasta } = req.body;

    if (fecha_desde === "" && fecha_hasta === "") {
      fecha_desde = fechaHoy;
      fecha_hasta = fechaHoy;
    }

    if (fecha_hasta == "") {
      fecha_hasta = fecha_desde;
    }

    if (fecha_desde == "") {
      fecha_desde = fecha_hasta;
    }

    console.log(req.body);

    Historicos.findAll({
      where: {
        fecha: {
          [Op.between]: [fecha_desde + " 00:00:00", fecha_hasta + " 23:59:59"],
        },
      },
    })
      .then((result) => res.json(result))
      .catch((error) => {
        res.status(402).json({
          msg: error.menssage,
        });
      });
  });
  
  // .post((req, res) => {
  //   Historicos.create(req.body)
  //     .then((result) => res.json(result))
  //     .catch((error) => res.json(error));
  // });

  // app
  //   .route("/roles/:role_id")
  //   .get((req, res) => {
  //     Roles.findOne({
  //       where: req.params,
  //     })
  //       .then((result) => res.json(result))
  //       .catch((error) => {
  //         res.status(404).json({
  //           msg: error.message,
  //         });
  //       });
  //   })
  //   .put((req, res) => {
  //     Roles.update(req.body, {
  //       where: req.params,
  //     })
  //       .then((result) => res.sendStatus(204))
  //       .catch((error) => {
  //         res.status(412).json({
  //           msg: error.message,
  //         });
  //       });
  //   })
  //   .delete((req, res) => {
  //     //const id = req.params.id;
  //     Roles.destroy({
  //       where: req.params,
  //     })
  //       .then(() => res.json(req.params))
  //       .catch((error) => {
  //         res.status(412).json({
  //           msg: error.message,
  //         });
  //       });
  //   });
};
