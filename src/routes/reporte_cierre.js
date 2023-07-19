const { Op } = require("sequelize");
const cron = require("node-cron");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
// Para crear la imagen
const { createCanvas, loadImage } = require("canvas");
// Conexion con firebird
var Firebird = require("node-firebird");

// Conexion con JKMT
var odontos = {};

odontos.host = "192.168.10.247";
odontos.port = 3050;
odontos.database = "c:\\\\jakemate\\\\base\\\\ODONTOS64.fdb";
odontos.user = "SYSDBA";
odontos.password = "masterkey";
odontos.lowercase_keys = false; // set to true to lowercase keys
odontos.role = null; // default
odontos.retryConnectionInterval = 1000; // reconnect interval in case of connection drop
odontos.blobAsText = false;

// Dimensiones del ticket
const width = 1920;
const height = 1080;

// Instantiate the canvas object
const canvas = createCanvas(width, height);
const context = canvas.getContext("2d");

// Logo de odontos
const imagePath = path.join(__dirname, "..", "assets", "img", "odontos_background.jpeg");

// Datos del Mensaje de whatsapp
let mensajePie = `Se ha registrado su turno! 😁
Para cualquier consulta, contáctanos escribiendo al WhatsApp del 0214129000
`;
let fileMimeTypeMedia = "image/png";
let fileBase64Media = "";
let mensajeBody = "";

// URL del WWA Prod - Centos
const wwaUrl = "http://192.168.10.200:3001/lead";
// URL al WWA test
//const wwaUrl = "http://localhost:3001/lead";

// Tiempo de retraso de consulta al PGSQL para iniciar el envio. 1 minuto
var tiempoRetrasoPGSQL = 10000;
// Tiempo entre envios. Cada 15s se realiza el envío a la API free WWA
var tiempoRetrasoEnvios = 15000;

module.exports = (app) => {
  const Reporte_cierre = app.db.models.Reporte_cierre;
  const Reporte_turnos = app.db.models.Reporte_turno;
  const Users = app.db.models.Users;

  // Ejecutar la funcion cada 10min de 07:00 a 19:59 de Lunes(1) a Sabados (6)
  cron.schedule("00 22 * * 1-6", () => {
    let hoyAhora = new Date();
    let diaHoy = hoyAhora.toString().slice(0, 3);
    let fullHoraAhora = hoyAhora.toString().slice(16, 21);

    console.log("Hoy es:", diaHoy, "la hora es:", fullHoraAhora);
    console.log("CRON: Se consulta al JKMT Reporte Gerencial");
    //injeccionFirebird();
  });

  // Trae los datos del reporte JKMT al PGSQL
  function injeccionFirebird() {
    let todasSucursales = [
      "1811 SUCURSAL",
      "ADMINISTRACION",
      "ARTIGAS",
      "AVENIDA QUINTA",
      "AYOLAS",
      "CAACUPE",
      "CAMPO 9",
      "CAPIATA",
      "CATEDRAL",
      "CORONEL OVIEDO",
      "ENCARNACION CENTRO",
      "HOHENAU",
      "ITAUGUA",
      "KM 14 Y MEDIO",
      "KM 7",
      "LA RURAL",
      "LAMBARE",
      "LUISITO",
      "LUQUE",
      "MARIA AUXILIADORA",
      "MARISCAL LOPEZ",
      "PALMA",
      "SANTA RITA",
      "VILLA MORRA",
      "ÑEMBY",
      "SUC. SANTANI",
    ];

    let todasSucursalesReporte = [];

    let fechaHoy = new Date().toISOString().slice(0, 10);

    Firebird.attach(odontos, function (err, db) {
      if (err) throw err;

      // db = DATABASE
      db.query(
        // Trae los ultimos 50 registros de turnos del JKMT
        "SELECT * FROM PROC_PANEL_ING_X_CONCEPTO_X_SUC(CURRENT_DATE, CURRENT_DATE)",

        function (err, result) {
          console.log("Cant de registros obtenidos:", result.length);
          //console.log(result);

          // Se carga la lista de las sucursales presentes para checkear las que no estan
          for (let r of result) {
            if (!todasSucursalesReporte.includes(r.SUCURSAL)) {
              todasSucursalesReporte.push(r.SUCURSAL);
            }
          }

          //console.log(todasSucursalesReporte);

          // Checkea las sucursales que no estan en la lista
          // Si no esta se crea el objeto y carga en el array
          for (let su of todasSucursales) {
            if (!todasSucursalesReporte.includes(su)) {
              let objSucursalFaltante = {
                SUCURSAL: su,
                CONCEPTO: "TRATAMIENTO",
                MONTO: 0,
              };

              result.push(objSucursalFaltante);
              console.log("Sucursales que NO estan", su);
            }
          }

          //console.log('RESULT AHORA', result);

          // SE FORMATEA EL ARRAY COMO PARA INSERTAR EN EL POSTGRESQL
          const nuevoArray = result.reduce((acumulador, objeto) => {
            const index = acumulador.findIndex((item) => item.SUCURSAL === objeto.SUCURSAL);

            if (index === -1) {
              acumulador.push({
                FECHA: fechaHoy,
                SUCURSAL: objeto.SUCURSAL,
                CUOTA_SOCIAL: objeto.CONCEPTO === "CUOTA SOCIAL       " ? objeto.MONTO : 0,
                TRATAMIENTO: objeto.CONCEPTO === "TRATAMIENTO        " ? objeto.MONTO : 0,
                COBRADOR: objeto.CONCEPTO === "REND COBRADOR      " ? objeto.MONTO : 0,
                VENTA_NUEVA: objeto.CONCEPTO === "VENTA NUEVA        " ? objeto.MONTO : 0,
                MONTO_TOTAL: objeto.MONTO,
                user_id: 1,
              });
            } else {
              acumulador[index].CUOTA_SOCIAL +=
                objeto.CONCEPTO === "CUOTA SOCIAL       " ? objeto.MONTO : 0;
              acumulador[index].TRATAMIENTO +=
                objeto.CONCEPTO === "TRATAMIENTO        " ? objeto.MONTO : 0;
              acumulador[index].COBRADOR +=
                objeto.CONCEPTO === "REND COBRADOR      " ? objeto.MONTO : 0;
              acumulador[index].VENTA_NUEVA +=
                objeto.CONCEPTO === "VENTA NUEVA        " ? objeto.MONTO : 0;
              acumulador[index].MONTO_TOTAL += objeto.MONTO;
            }

            return acumulador;
          }, []);

          //console.log('Array formateado para insertar en el POSTGRESQL', nuevoArray);

          // Recorre el array que contiene los datos e inserta en la base de postgresql
          nuevoArray.forEach((e) => {
            // Poblar PGSQL
            Reporte_cierre.create(e)
              //.then((result) => res.json(result))
              .catch((error) => console.log(error.message));
          });

          // IMPORTANTE: cerrar la conexion
          db.detach();
          console.log(
            "Llama a la funcion iniciar envio que se retrasa 1 min en ejecutarse Tickets"
          );
        }
      );
    });
  }

  //injeccionFirebird();

  // Trae las cantidades de los turnos
  function injeccionFirebirdTurnos() {
    let fechaHoy = new Date().toISOString().slice(0, 10);

    Firebird.attach(odontos, function (err, db) {
      if (err) throw err;

      // db = DATABASE
      db.query(
        // Trae los ultimos 50 registros de turnos del JKMT
        `SELECT
        S.NOMBRE AS SUCURSAL,
        COUNT (T.COD_TURNO) as AGENDADOS,
        SUM(T.ASISTIO) AS ASISTIDOS,
        COUNT (DISTINCT T.COD_PROFESIONAL) AS PROFESIONAL
        FROM
        TURNOS T
        INNER JOIN SUCURSALES S ON T.COD_SUCURSAL = S.COD_SUCURSAL
        WHERE T.FECHA_TURNO BETWEEN (CURRENT_DATE) AND (CURRENT_DATE+1)
        AND T.ANULADO IS NULL
        GROUP BY S.NOMBRE`,

        function (err, result) {
          console.log("Cant de turnos obtenidos del JKMT:", result.length);
          console.log(fechaHoy);
          console.log(result);

          const nuevoArray = result.reduce((acumulador, objeto) => {
            const index = acumulador.findIndex((item) => item.SUCURSAL === objeto.SUCURSAL);

            if (index === -1) {
              acumulador.push({
                FECHA: fechaHoy,
                SUCURSAL: objeto.SUCURSAL,
                AGENDADOS: objeto.AGENDADOS,
                ASISTIDOS: objeto.ASISTIDOS,
                PROFESIONAL: objeto.PROFESIONAL,
                user_id: 1,
              });
            }

            return acumulador;
          }, []);

          //console.log(nuevoArray);

          // Recorre el array que contiene los datos e inserta en la base de postgresql
          nuevoArray.forEach((e) => {
            // Poblar PGSQL
            Reporte_turnos.create(e)
              //.then((result) => res.json(result))
              .catch((error) => console.log(error.message));
          });

          // IMPORTANTE: cerrar la conexion
          db.detach();
          console.log(
            "Llama a la funcion iniciar envio que se retrasa 1 min en ejecutarse Tickets"
          );
        }
      );
    });
  }

  //injeccionFirebirdTurnos();

  // Inicia los envios - Consulta al PGSQL
  let losReportes = [];
  let losReportesFormateado = [];
  let losTurnosCantidades = [];

  function iniciarEnvio() {
    setTimeout(() => {
      // Datos de los turnos
      // Reporte_turnos.findAll({
      //   where: { FECHA: "2023-07-19" },
      //   //order: [["createdAt", "ASC"]],
      // })
      //   .then((result) => {
      //     losTurnosCantidades = result;
      //     console.log(losTurnosCantidades);
      //   })
      //   .catch((error) => {
      //     res.status(402).json({
      //       msg: error.menssage,
      //     });
      //   });

      // Datos del cierre
      Reporte_cierre.findAll({
        where: { FECHA: "2023-07-19" },
        //order: [["createdAt", "ASC"]],
      })
        .then((result) => {
          losReportes = result;
          console.log("Preparando reporte:", losReportes.length);

          losReportesFormateado = result.map((objeto) => ({
            ...objeto,
            FECHA: "19-07-2023",
            SUCURSAL: objeto.SUCURSAL,
            CUOTA_SOCIAL:
              objeto.CUOTA_SOCIAL !== "0"
                ? parseFloat(objeto.CUOTA_SOCIAL).toLocaleString("es", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })
                : objeto.CUOTA_SOCIAL,
            TRATAMIENTO:
              objeto.TRATAMIENTO !== "0"
                ? parseFloat(objeto.TRATAMIENTO).toLocaleString("es", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })
                : objeto.TRATAMIENTO,
            COBRADOR: objeto.COBRADOR,
            VENTA_NUEVA: objeto.VENTA_NUEVA,
            MONTO_TOTAL:
              objeto.MONTO_TOTAL !== "0"
                ? parseFloat(objeto.MONTO_TOTAL).toLocaleString("es", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })
                : objeto.MONTO_TOTAL,
          }));

          //console.log(losReportesFormateado);
        })
        .then(() => {
          enviarMensaje();
        })
        .catch((error) => {
          res.status(402).json({
            msg: error.menssage,
          });
        });
    }, tiempoRetrasoPGSQL);
  }

  iniciarEnvio();

  // Envia los mensajes
  let retraso = () => new Promise((r) => setTimeout(r, tiempoRetrasoEnvios));
  async function enviarMensaje() {
    console.log("Inicia el recorrido del for para enviar el reporte");
    //for (let i = 0; i < losReportes.length; i++) {
    //const turnoId = losReportes[i].id_turno;

    // Dibuja la imagen
    loadImage(imagePath).then((image) => {
      // Dibuja la imagen de fondo
      context.drawImage(image, 0, 0, width, height);

      let ejeXfecha = 120;
      let ejeXsucu = 220;
      let ejeXcuota = 440;
      let ejeXtrata = 570;
      let ejeXcobra = 710;
      let ejeXventa = 820;
      let ejeXmonto = 970;

      let ejeY = 150;

      for (let r of losReportesFormateado) {
        if (r.SUCURSAL == "LUISITO") {
          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.shadowColor = "red";
          context.fillText(r.FECHA, ejeXfecha, ejeY);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.fillText(r.SUCURSAL, ejeXsucu, ejeY);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.CUOTA_SOCIAL, ejeXcuota, ejeY);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.TRATAMIENTO, ejeXtrata, ejeY);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.COBRADOR, ejeXcobra, ejeY);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.VENTA_NUEVA, ejeXventa, ejeY);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.MONTO_TOTAL, ejeXmonto, ejeY);
        }

        if (r.SUCURSAL == "SUC. SANTANI") {
          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.shadowColor = "red";
          context.fillText(r.FECHA, ejeXfecha, ejeY);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.fillText(r.SUCURSAL, ejeXsucu, ejeY);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.CUOTA_SOCIAL, ejeXcuota, ejeY);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.TRATAMIENTO, ejeXtrata, ejeY);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.COBRADOR, ejeXcobra, ejeY);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.VENTA_NUEVA, ejeXventa, ejeY);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.MONTO_TOTAL, ejeXmonto, ejeY);
        }

        ejeY = ejeY + 20;
      }

      // Escribe la imagen a archivo
      const buffer = canvas.toBuffer("image/png");
      fs.writeFileSync("./imagen.png", buffer);
      fs.writeFileSync("./2023-07-19.png", buffer);

      // Convierte el canvas en una imagen base64
      const base64Image = canvas.toDataURL();
      fileBase64Media = base64Image.split(",")[1];
    });
    // .then(() => {
    //   mensajeBody = {
    //     message: mensajePie,
    //     phone: losTurnos[i].TELEFONO_MOVIL,
    //     mimeType: fileMimeTypeMedia,
    //     data: fileBase64Media,
    //     fileName: "",
    //     fileSize: "",
    //   };

    //   //console.log(mensajeBody);
    // })
    // .then(() => {
    //   // Funcion ajax para nodejs que realiza los envios a la API free WWA
    //   axios
    //     .post(wwaUrl, mensajeBody)
    //     .then((response) => {
    //       const data = response.data;

    //       if (data.responseExSave.id) {
    //         console.log("Enviado - OK");
    //         // Se actualiza el estado a 1
    //         const body = {
    //           estado_envio: 1,
    //         };

    //         Tickets.update(body, {
    //           where: { id_turno: turnoId },
    //         })
    //           //.then((result) => res.json(result))
    //           .catch((error) => {
    //             res.status(412).json({
    //               msg: error.message,
    //             });
    //           });
    //       }

    //       if (data.responseExSave.unknow) {
    //         console.log("No Enviado - unknow");
    //         // Se actualiza el estado a 3
    //         const body = {
    //           estado_envio: 3,
    //         };

    //         Tickets.update(body, {
    //           where: { id_turno: turnoId },
    //         })
    //           //.then((result) => res.json(result))
    //           .catch((error) => {
    //             res.status(412).json({
    //               msg: error.message,
    //             });
    //           });
    //       }

    //       if (data.responseExSave.error) {
    //         console.log("No enviado - error");
    //         const errMsg = data.responseExSave.error.slice(0, 17);
    //         if (errMsg === "Escanee el código") {
    //           updateEstatusERROR(turnoId, 104);
    //           //console.log("Error 104: ", data.responseExSave.error);
    //         }
    //         // Sesion cerrada o desvinculada. Puede que se envie al abrir la sesion o al vincular
    //         if (errMsg === "Protocol error (R") {
    //           updateEstatusERROR(turnoId, 105);
    //           //console.log("Error 105: ", data.responseExSave.error);
    //         }
    //         // El numero esta mal escrito o supera los 12 caracteres
    //         if (errMsg === "Evaluation failed") {
    //           updateEstatusERROR(turnoId, 106);
    //           //console.log("Error 106: ", data.responseExSave.error);
    //         }
    //       }
    //     })
    //     .catch((error) => {
    //       console.error("Ocurrió un error:", error);
    //     });
    // });

    await retraso();
    //}

    console.log("Fin del envío");
    console.log("Luego de 1m se vuelve a consultar al PGSQL");
    setTimeout(() => {
      //iniciarEnvio();
    }, 10000);
  }

  function updateEstatusERROR(turnoId, cod_error) {
    // Se actualiza el estado segun el errors
    const body = {
      estado_envio: cod_error,
    };

    Tickets.update(body, {
      where: { id_turno: turnoId },
    })
      //.then((result) => res.json(result))
      .catch((error) => {
        res.status(412).json({
          msg: error.message,
        });
      });
  }

  /*
    Metodos
  */

  app
    .route("/tickets")
    .get((req, res) => {
      Tickets.findAll({
        order: [["createdAt", "DESC"]],
      })
        .then((result) => res.json(result))
        .catch((error) => {
          res.status(402).json({
            msg: error.menssage,
          });
        });
    })
    .post((req, res) => {
      console.log(req.body);
      Tickets.create(req.body)
        .then((result) => res.json(result))
        .catch((error) => res.json(error));
    });

  // Trae los turnos que tengan en el campo estado_envio = 0
  app.route("/ticketsPendientes").get((req, res) => {
    Tickets.findAll({
      where: { estado_envio: 0 },
      order: [["FECHA_CREACION", "ASC"]],
      //limit: 5
    })
      .then((result) => res.json(result))
      .catch((error) => {
        res.status(402).json({
          msg: error.menssage,
        });
      });
  });

  // Trae los turnos que ya fueron notificados hoy
  app.route("/ticketsNotificados").get((req, res) => {
    // Fecha de hoy 2022-02-30
    let fechaHoy = new Date().toISOString().slice(0, 10);

    Tickets.count({
      where: {
        [Op.and]: [
          { estado_envio: 1 },
          {
            updatedAt: {
              [Op.between]: [fechaHoy + " 00:00:00", fechaHoy + " 23:59:59"],
            },
          },
        ],
      },
      //order: [["FECHA_CREACION", "DESC"]],
    })
      .then((result) => res.json(result))
      .catch((error) => {
        res.status(402).json({
          msg: error.menssage,
        });
      });
  });

  // Trae la cantidad de turnos enviados por rango de fecha desde hasta
  app.route("/ticketsNotificadosFecha").post((req, res) => {
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

    Tickets.count({
      where: {
        [Op.and]: [
          { estado_envio: 1 },
          {
            updatedAt: {
              [Op.between]: [fecha_desde + " 00:00:00", fecha_hasta + " 23:59:59"],
            },
          },
        ],
      },
      //order: [["createdAt", "DESC"]],
    })
      .then((result) => res.json(result))
      .catch((error) => {
        res.status(402).json({
          msg: error.menssage,
        });
      });
  });

  // Turnos no enviados - estado_envio 2 o 3
  app.route("/ticketsNoNotificados").get((req, res) => {
    // Fecha de hoy 2022-02-30
    let fechaHoy = new Date().toISOString().slice(0, 10);
    Tickets.count({
      where: {
        [Op.and]: [
          { estado_envio: { [Op.in]: [2, 3] } },
          {
            updatedAt: {
              [Op.between]: [fechaHoy + " 00:00:00", fechaHoy + " 23:59:59"],
            },
          },
        ],
      },
      //order: [["FECHA_CREACION", "DESC"]],
    })
      .then((result) => res.json(result))
      .catch((error) => {
        res.status(402).json({
          msg: error.menssage,
        });
      });
  });

  // // Trae la cantidad de turnos enviados por rango de fecha desde hasta
  // app.route("/turnosNoNotificadosFecha").post((req, res) => {
  //   let fechaHoy = new Date().toISOString().slice(0, 10);
  //   let { fecha_desde, fecha_hasta } = req.body;

  //   if (fecha_desde === "" && fecha_hasta === "") {
  //     fecha_desde = fechaHoy;
  //     fecha_hasta = fechaHoy;
  //   }

  //   if (fecha_hasta == "") {
  //     fecha_hasta = fecha_desde;
  //   }

  //   if (fecha_desde == "") {
  //     fecha_desde = fecha_hasta;
  //   }

  //   console.log(req.body);

  //   Turnos.count({
  //     where: {
  //       [Op.and]: [
  //         { estado_envio: { [Op.in]: [2, 3] } },
  //         {
  //           updatedAt: {
  //             [Op.between]: [
  //               fecha_desde + " 00:00:00",
  //               fecha_hasta + " 23:59:59",
  //             ],
  //           },
  //         },
  //       ],
  //     },
  //     //order: [["createdAt", "DESC"]],
  //   })
  //     .then((result) => res.json(result))
  //     .catch((error) => {
  //       res.status(402).json({
  //         msg: error.menssage,
  //       });
  //     });
  // });

  app
    .route("/tickets/:id_turno")
    .get((req, res) => {
      Tickets.findOne({
        where: req.params,
        include: [
          {
            model: Users,
            attributes: ["user_fullname"],
          },
        ],
      })
        .then((result) => res.json(result))
        .catch((error) => {
          res.status(404).json({
            msg: error.message,
          });
        });
    })
    .put((req, res) => {
      Tickets.update(req.body, {
        where: req.params,
      })
        .then((result) => res.json(result))
        .catch((error) => {
          res.status(412).json({
            msg: error.message,
          });
        });
    })
    .delete((req, res) => {
      //const id = req.params.id;
      Tickets.destroy({
        where: req.params,
      })
        .then(() => res.json(req.params))
        .catch((error) => {
          res.status(412).json({
            msg: error.message,
          });
        });
    });
};
