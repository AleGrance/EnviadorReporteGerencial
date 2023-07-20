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

  // Sub Totales Zona Asuncion
  let sumTotalesAsuncionCS = 0;
  let sumTotalesAsuncionTT = 0;
  let sumTotalesAsuncionCO = 0;
  let sumTotalesAsuncionVN = 0;
  let sumTotalesAsuncionMT = 0;
  let sumTotalesAsuncionAG = 0;
  let sumTotalesAsuncionAS = 0;
  let sumTotalesAsuncionPR = 0;

  // Sub Totales Zona Gran Asuncion
  let sumTotalesGAsuncionCS = 0;
  let sumTotalesGAsuncionTT = 0;
  let sumTotalesGAsuncionCO = 0;
  let sumTotalesGAsuncionVN = 0;
  let sumTotalesGAsuncionMT = 0;
  let sumTotalesGAsuncionAG = 0;
  let sumTotalesGAsuncionAS = 0;
  let sumTotalesGAsuncionPR = 0;

  // Sub Totales Zona Ruta 2
  let sumTotalesR2CS = 0;
  let sumTotalesR2TT = 0;
  let sumTotalesR2CO = 0;
  let sumTotalesR2VN = 0;
  let sumTotalesR2MT = 0;
  let sumTotalesR2AG = 0;
  let sumTotalesR2AS = 0;
  let sumTotalesR2PR = 0;

  // Sub Totales Zona Itapua
  let sumTotalesItaCS = 0;
  let sumTotalesItaTT = 0;
  let sumTotalesItaCO = 0;
  let sumTotalesItaVN = 0;
  let sumTotalesItaMT = 0;
  let sumTotalesItaAG = 0;
  let sumTotalesItaAS = 0;
  let sumTotalesItaPR = 0;

  // Sub Totales Zona Alto Parana
  let sumTotalesApCS = 0;
  let sumTotalesApTT = 0;
  let sumTotalesApCO = 0;
  let sumTotalesApVN = 0;
  let sumTotalesApMT = 0;
  let sumTotalesApAG = 0;
  let sumTotalesApAS = 0;
  let sumTotalesApPR = 0;

  function iniciarEnvio() {
    setTimeout(() => {
      // Datos de las cantidades de los turnos
      Reporte_turnos.findAll({
        where: { FECHA: "2023-07-19" },
        //order: [["createdAt", "ASC"]],
      })
        .then((result) => {
          losTurnosCantidades = result;
          //console.log(losTurnosCantidades);
        })
        .catch((error) => {
          res.status(402).json({
            msg: error.menssage,
          });
        });

      // Datos del cierre
      Reporte_cierre.findAll({
        where: { FECHA: "2023-07-19" },
        //order: [["createdAt", "ASC"]],
      })
        .then((result) => {
          losReportes = result;
          console.log("Preparando reporte:", losReportes.length);
          //console.log("Preparando reporte:", losReportes);

          sumarMontos(losReportes);

          losReportesFormateado = result.map((objeto) => ({
            ...objeto,
            FECHA: "19-07-2023",
            SUCURSAL: objeto.SUCURSAL,
            CUOTA_SOCIAL:
              objeto.CUOTA_SOCIAL !== "0"
                ? parseFloat(objeto.CUOTA_SOCIAL).toLocaleString("es", {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 0,
                  })
                : objeto.CUOTA_SOCIAL,
            TRATAMIENTO:
              objeto.TRATAMIENTO !== "0"
                ? parseFloat(objeto.TRATAMIENTO).toLocaleString("es", {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 0,
                  })
                : objeto.TRATAMIENTO,
            COBRADOR:
              objeto.COBRADOR !== "0"
                ? parseFloat(objeto.COBRADOR).toLocaleString("es", {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 0,
                  })
                : objeto.COBRADOR,
            VENTA_NUEVA:
              objeto.VENTA_NUEVA !== "0"
                ? parseFloat(objeto.VENTA_NUEVA).toLocaleString("es", {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 0,
                  })
                : objeto.VENTA_NUEVA,
            MONTO_TOTAL:
              objeto.MONTO_TOTAL !== "0"
                ? parseFloat(objeto.MONTO_TOTAL).toLocaleString("es", {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 0,
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

  function sumarMontos(los_reportes) {
    let arrayAsuncion = [
      "MARISCAL LOPEZ",
      "AVENIDA QUINTA",
      "VILLA MORRA",
      "ARTIGAS",
      "LUISITO",
      "PALMA",
    ];
    let arrayGAsuncion = [
      "LAMBARE",
      "CATEDRAL",
      "LUQUE",
      "LA RURAL",
      "ÑEMBY",
      "ITAUGUA",
      "1811 SUCURSAL",
      "KM 14 Y MEDIO",
      "CAPIATA",
    ];
    let arrayRuta2 = ["CAACUPE", "CORONEL OVIEDO"];
    let arrayItapua = ["HOHENAU", "ENCARNACION CENTRO", "MARIA AUXILIADORA", "AYOLAS"];
    let arrayAltop = ["KM 7", "SANTA RITA", "CAMPO 9"];

    //console.log('DESDE SUMAR MONTOS', los_reportes.length);

    for (let r of los_reportes) {
      // Suma los montos de los cierres
      if (arrayAsuncion.includes(r.SUCURSAL)) {
        sumTotalesAsuncionCS += parseInt(r.CUOTA_SOCIAL);
        sumTotalesAsuncionTT += parseInt(r.TRATAMIENTO);
        sumTotalesAsuncionCO += parseInt(r.COBRADOR);
        sumTotalesAsuncionVN += parseInt(r.VENTA_NUEVA);
        sumTotalesAsuncionMT += parseInt(r.MONTO_TOTAL);
      }

      if (arrayGAsuncion.includes(r.SUCURSAL)) {
        sumTotalesGAsuncionCS += parseInt(r.CUOTA_SOCIAL);
        sumTotalesGAsuncionTT += parseInt(r.TRATAMIENTO);
        sumTotalesGAsuncionCO += parseInt(r.COBRADOR);
        sumTotalesGAsuncionVN += parseInt(r.VENTA_NUEVA);
        sumTotalesGAsuncionMT += parseInt(r.MONTO_TOTAL);
      }

      if (arrayRuta2.includes(r.SUCURSAL)) {
        sumTotalesR2CS += parseInt(r.CUOTA_SOCIAL);
        sumTotalesR2TT += parseInt(r.TRATAMIENTO);
        sumTotalesR2CO += parseInt(r.COBRADOR);
        sumTotalesR2VN += parseInt(r.VENTA_NUEVA);
        sumTotalesR2MT += parseInt(r.MONTO_TOTAL);
      }

      if (arrayItapua.includes(r.SUCURSAL)) {
        sumTotalesItaCS += parseInt(r.CUOTA_SOCIAL);
        sumTotalesItaTT += parseInt(r.TRATAMIENTO);
        sumTotalesItaCO += parseInt(r.COBRADOR);
        sumTotalesItaVN += parseInt(r.VENTA_NUEVA);
        sumTotalesItaMT += parseInt(r.MONTO_TOTAL);
      }

      if (arrayAltop.includes(r.SUCURSAL)) {
        sumTotalesApCS += parseInt(r.CUOTA_SOCIAL);
        sumTotalesApTT += parseInt(r.TRATAMIENTO);
        sumTotalesApCO += parseInt(r.COBRADOR);
        sumTotalesApVN += parseInt(r.VENTA_NUEVA);
        sumTotalesApMT += parseInt(r.MONTO_TOTAL);
      }
    }

    // Suma las cantidades de los turnos
    for (let t of losTurnosCantidades) {
      if (arrayAsuncion.includes(t.SUCURSAL)) {
        sumTotalesAsuncionAG += parseInt(t.AGENDADOS);
        sumTotalesAsuncionAS += parseInt(t.ASISTIDOS);
        sumTotalesAsuncionPR += parseInt(t.PROFESIONAL);
      }

      if (arrayGAsuncion.includes(t.SUCURSAL)) {
        sumTotalesGAsuncionAG += parseInt(t.AGENDADOS);
        sumTotalesGAsuncionAS += parseInt(t.ASISTIDOS);
        sumTotalesGAsuncionPR += parseInt(t.PROFESIONAL);
      }

      if (arrayRuta2.includes(t.SUCURSAL)) {
        sumTotalesR2AG += parseInt(t.AGENDADOS);
        sumTotalesR2AS += parseInt(t.ASISTIDOS);
        sumTotalesR2PR += parseInt(t.PROFESIONAL);
      }

      if (arrayItapua.includes(t.SUCURSAL)) {
        sumTotalesItaAG += parseInt(t.AGENDADOS);
        sumTotalesItaAS += parseInt(t.ASISTIDOS);
        sumTotalesItaPR += parseInt(t.PROFESIONAL);
      }

      if (arrayAltop.includes(t.SUCURSAL)) {
        sumTotalesApAG += parseInt(t.AGENDADOS);
        sumTotalesApAS += parseInt(t.ASISTIDOS);
        sumTotalesApPR += parseInt(t.PROFESIONAL);
      }
    }

    console.log(sumTotalesAsuncionMT);
  }

  // Envia los mensajes
  let retraso = () => new Promise((r) => setTimeout(r, tiempoRetrasoEnvios));
  async function enviarMensaje() {
    console.log("Inicia el recorrido del for para dibujar y enviar el reporte");

    // Dibuja la imagen
    loadImage(imagePath).then((image) => {
      // Dibuja la imagen de fondo
      context.drawImage(image, 0, 0, width, height);

      // Eje X de cada celda - Cierres
      let ejeXfecha = 120;
      let ejeXsucu = 220;
      let ejeXcuota = 440;
      let ejeXtrata = 570;
      let ejeXcobra = 710;
      let ejeXventa = 820;
      let ejeXmonto = 970;

      // Eje X de cada celda - Cantiad turnos
      let ejeXagendado = 1060;
      let ejeXasistido = 1160;
      let ejeXprofesional = 1260;

      /** */

      // Eje Y de cada fila
      let ejeYml = 150;
      let ejeYaq = 170;
      let ejeYvm = 190;
      let ejeYar = 210;
      let ejeYlu = 230;
      let ejeYpa = 250;

      let ejeYtotalesAsu = 270;

      let ejeYlam = 290;
      let ejeYcat = 310;
      let ejeYluq = 330;
      let ejeYlar = 350;
      let ejeYnem = 370;
      let ejeYita = 390;
      let ejeY1811 = 410;
      let ejeYkm14 = 430;
      let ejeYcap = 450;

      let ejeYtotalesGranAsu = 470;

      let ejeYcaac = 490;
      let ejeYcoro = 510;

      let ejeYtotalesRuta2 = 530;

      let ejeYhohe = 550;
      let ejeYencar = 570;
      let ejeYmaria = 590;
      let ejeYayo = 610;

      let ejeYtotalesItapua = 630;

      let ejeYkm7 = 650;
      let ejeYsanta = 670;
      let ejeYcampo = 690;

      let ejeYtotalesAltoP = 710;

      for (let r of losReportesFormateado) {
        // Zona ASU
        if (r.SUCURSAL == "MARISCAL LOPEZ") {
          // Busca los turnos por sucursal y los dibuja en el canva
          for (let t of losTurnosCantidades) {
            if (r.SUCURSAL == t.SUCURSAL) {
              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.AGENDADOS, ejeXagendado, ejeYml);

              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.ASISTIDOS, ejeXasistido, ejeYml);

              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.PROFESIONAL, ejeXprofesional, ejeYml);
            }
          }

          // Se dibuja los datos del cierre
          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.fillText(r.FECHA, ejeXfecha, ejeYml);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.fillText(r.SUCURSAL, ejeXsucu, ejeYml);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.CUOTA_SOCIAL, ejeXcuota, ejeYml);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.TRATAMIENTO, ejeXtrata, ejeYml);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.COBRADOR, ejeXcobra, ejeYml);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.VENTA_NUEVA, ejeXventa, ejeYml);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.MONTO_TOTAL, ejeXmonto, ejeYml);
        }

        if (r.SUCURSAL == "AVENIDA QUINTA") {
          // Busca los turnos por sucursal y los dibuja en el canva
          for (let t of losTurnosCantidades) {
            if (r.SUCURSAL == t.SUCURSAL) {
              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.AGENDADOS, ejeXagendado, ejeYaq);

              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.ASISTIDOS, ejeXasistido, ejeYaq);

              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.PROFESIONAL, ejeXprofesional, ejeYaq);
            }
          }

          // Se dibuja los datos del cierre
          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.fillText(r.FECHA, ejeXfecha, ejeYaq);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.fillText(r.SUCURSAL, ejeXsucu, ejeYaq);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.CUOTA_SOCIAL, ejeXcuota, ejeYaq);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.TRATAMIENTO, ejeXtrata, ejeYaq);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.COBRADOR, ejeXcobra, ejeYaq);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.VENTA_NUEVA, ejeXventa, ejeYaq);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.MONTO_TOTAL, ejeXmonto, ejeYaq);
        }

        if (r.SUCURSAL == "VILLA MORRA") {
          // Busca los turnos por sucursal y los dibuja en el canva
          for (let t of losTurnosCantidades) {
            if (r.SUCURSAL == t.SUCURSAL) {
              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.AGENDADOS, ejeXagendado, ejeYvm);

              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.ASISTIDOS, ejeXasistido, ejeYvm);

              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.PROFESIONAL, ejeXprofesional, ejeYvm);
            }
          }

          // Se dibuja los datos del cierre
          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.fillText(r.FECHA, ejeXfecha, ejeYvm);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.fillText(r.SUCURSAL, ejeXsucu, ejeYvm);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.CUOTA_SOCIAL, ejeXcuota, ejeYvm);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.TRATAMIENTO, ejeXtrata, ejeYvm);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.COBRADOR, ejeXcobra, ejeYvm);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.VENTA_NUEVA, ejeXventa, ejeYvm);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.MONTO_TOTAL, ejeXmonto, ejeYvm);
        }

        if (r.SUCURSAL == "ARTIGAS") {
          // Busca los turnos por sucursal y los dibuja en el canva
          for (let t of losTurnosCantidades) {
            if (r.SUCURSAL == t.SUCURSAL) {
              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.AGENDADOS, ejeXagendado, ejeYar);

              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.ASISTIDOS, ejeXasistido, ejeYar);

              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.PROFESIONAL, ejeXprofesional, ejeYar);
            }
          }

          // Se dibuja los datos del cierre
          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.fillText(r.FECHA, ejeXfecha, ejeYar);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.fillText(r.SUCURSAL, ejeXsucu, ejeYar);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.CUOTA_SOCIAL, ejeXcuota, ejeYar);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.TRATAMIENTO, ejeXtrata, ejeYar);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.COBRADOR, ejeXcobra, ejeYar);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.VENTA_NUEVA, ejeXventa, ejeYar);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.MONTO_TOTAL, ejeXmonto, ejeYar);
        }

        if (r.SUCURSAL == "LUISITO") {
          // Busca los turnos por sucursal y los dibuja en el canva
          for (let t of losTurnosCantidades) {
            if (r.SUCURSAL == t.SUCURSAL) {
              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.AGENDADOS, ejeXagendado, ejeYlu);

              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.ASISTIDOS, ejeXasistido, ejeYlu);

              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.PROFESIONAL, ejeXprofesional, ejeYlu);
            }
          }

          // Se dibuja los datos del cierre
          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.fillText(r.FECHA, ejeXfecha, ejeYlu);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.fillText(r.SUCURSAL, ejeXsucu, ejeYlu);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.CUOTA_SOCIAL, ejeXcuota, ejeYlu);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.TRATAMIENTO, ejeXtrata, ejeYlu);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.COBRADOR, ejeXcobra, ejeYlu);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.VENTA_NUEVA, ejeXventa, ejeYlu);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.MONTO_TOTAL, ejeXmonto, ejeYlu);
        }

        if (r.SUCURSAL == "PALMA") {
          // Busca los turnos por sucursal y los dibuja en el canva
          for (let t of losTurnosCantidades) {
            if (r.SUCURSAL == t.SUCURSAL) {
              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.AGENDADOS, ejeXagendado, ejeYpa);

              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.ASISTIDOS, ejeXasistido, ejeYpa);

              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.PROFESIONAL, ejeXprofesional, ejeYpa);
            }
          }

          // Se dibuja los datos del cierre
          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.fillText(r.FECHA, ejeXfecha, ejeYpa);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.fillText(r.SUCURSAL, ejeXsucu, ejeYpa);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.CUOTA_SOCIAL, ejeXcuota, ejeYpa);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.TRATAMIENTO, ejeXtrata, ejeYpa);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.COBRADOR, ejeXcobra, ejeYpa);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.VENTA_NUEVA, ejeXventa, ejeYpa);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.MONTO_TOTAL, ejeXmonto, ejeYpa);
        }

        // Zona Gran ASU
        if (r.SUCURSAL == "LAMBARE") {
          // Busca los turnos por sucursal y los dibuja en el canva
          for (let t of losTurnosCantidades) {
            if (r.SUCURSAL == t.SUCURSAL) {
              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.AGENDADOS, ejeXagendado, ejeYlam);

              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.ASISTIDOS, ejeXasistido, ejeYlam);

              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.PROFESIONAL, ejeXprofesional, ejeYlam);
            }
          }

          // Se dibuja los datos del cierre
          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.fillText(r.FECHA, ejeXfecha, ejeYlam);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.fillText(r.SUCURSAL, ejeXsucu, ejeYlam);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.CUOTA_SOCIAL, ejeXcuota, ejeYlam);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.TRATAMIENTO, ejeXtrata, ejeYlam);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.COBRADOR, ejeXcobra, ejeYlam);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.VENTA_NUEVA, ejeXventa, ejeYlam);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.MONTO_TOTAL, ejeXmonto, ejeYlam);
        }

        if (r.SUCURSAL == "CATEDRAL") {
          // Busca los turnos por sucursal y los dibuja en el canva
          for (let t of losTurnosCantidades) {
            if (r.SUCURSAL == t.SUCURSAL) {
              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.AGENDADOS, ejeXagendado, ejeYcat);

              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.ASISTIDOS, ejeXasistido, ejeYcat);

              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.PROFESIONAL, ejeXprofesional, ejeYcat);
            }
          }

          // Se dibuja los datos del cierre
          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.fillText(r.FECHA, ejeXfecha, ejeYcat);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.fillText(r.SUCURSAL, ejeXsucu, ejeYcat);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.CUOTA_SOCIAL, ejeXcuota, ejeYcat);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.TRATAMIENTO, ejeXtrata, ejeYcat);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.COBRADOR, ejeXcobra, ejeYcat);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.VENTA_NUEVA, ejeXventa, ejeYcat);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.MONTO_TOTAL, ejeXmonto, ejeYcat);
        }

        if (r.SUCURSAL == "LUQUE") {
          // Busca los turnos por sucursal y los dibuja en el canva
          for (let t of losTurnosCantidades) {
            if (r.SUCURSAL == t.SUCURSAL) {
              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.AGENDADOS, ejeXagendado, ejeYluq);

              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.ASISTIDOS, ejeXasistido, ejeYluq);

              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.PROFESIONAL, ejeXprofesional, ejeYluq);
            }
          }

          // Se dibuja los datos del cierre
          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.fillText(r.FECHA, ejeXfecha, ejeYluq);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.fillText(r.SUCURSAL, ejeXsucu, ejeYluq);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.CUOTA_SOCIAL, ejeXcuota, ejeYluq);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.TRATAMIENTO, ejeXtrata, ejeYluq);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.COBRADOR, ejeXcobra, ejeYluq);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.VENTA_NUEVA, ejeXventa, ejeYluq);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.MONTO_TOTAL, ejeXmonto, ejeYluq);
        }

        if (r.SUCURSAL == "LA RURAL") {
          // Busca los turnos por sucursal y los dibuja en el canva
          for (let t of losTurnosCantidades) {
            if (r.SUCURSAL == t.SUCURSAL) {
              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.AGENDADOS, ejeXagendado, ejeYlar);

              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.ASISTIDOS, ejeXasistido, ejeYlar);

              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.PROFESIONAL, ejeXprofesional, ejeYlar);
            }
          }

          // Se dibuja los datos del cierre
          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.fillText(r.FECHA, ejeXfecha, ejeYlar);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.fillText(r.SUCURSAL, ejeXsucu, ejeYlar);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.CUOTA_SOCIAL, ejeXcuota, ejeYlar);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.TRATAMIENTO, ejeXtrata, ejeYlar);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.COBRADOR, ejeXcobra, ejeYlar);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.VENTA_NUEVA, ejeXventa, ejeYlar);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.MONTO_TOTAL, ejeXmonto, ejeYlar);
        }

        if (r.SUCURSAL == "ÑEMBY") {
          // Busca los turnos por sucursal y los dibuja en el canva
          for (let t of losTurnosCantidades) {
            if (r.SUCURSAL == t.SUCURSAL) {
              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.AGENDADOS, ejeXagendado, ejeYnem);

              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.ASISTIDOS, ejeXasistido, ejeYnem);

              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.PROFESIONAL, ejeXprofesional, ejeYnem);
            }
          }

          // Se dibuja los datos del cierre
          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.fillText(r.FECHA, ejeXfecha, ejeYnem);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.fillText(r.SUCURSAL, ejeXsucu, ejeYnem);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.CUOTA_SOCIAL, ejeXcuota, ejeYnem);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.TRATAMIENTO, ejeXtrata, ejeYnem);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.COBRADOR, ejeXcobra, ejeYnem);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.VENTA_NUEVA, ejeXventa, ejeYnem);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.MONTO_TOTAL, ejeXmonto, ejeYnem);
        }

        if (r.SUCURSAL == "ITAUGUA") {
          // Busca los turnos por sucursal y los dibuja en el canva
          for (let t of losTurnosCantidades) {
            if (r.SUCURSAL == t.SUCURSAL) {
              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.AGENDADOS, ejeXagendado, ejeYita);

              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.ASISTIDOS, ejeXasistido, ejeYita);

              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.PROFESIONAL, ejeXprofesional, ejeYita);
            }
          }

          // Se dibuja los datos del cierre
          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.fillText(r.FECHA, ejeXfecha, ejeYita);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.fillText(r.SUCURSAL, ejeXsucu, ejeYita);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.CUOTA_SOCIAL, ejeXcuota, ejeYita);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.TRATAMIENTO, ejeXtrata, ejeYita);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.COBRADOR, ejeXcobra, ejeYita);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.VENTA_NUEVA, ejeXventa, ejeYita);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.MONTO_TOTAL, ejeXmonto, ejeYita);
        }

        if (r.SUCURSAL == "1811 SUCURSAL") {
          // Busca los turnos por sucursal y los dibuja en el canva
          for (let t of losTurnosCantidades) {
            if (r.SUCURSAL == t.SUCURSAL) {
              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.AGENDADOS, ejeXagendado, ejeY1811);

              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.ASISTIDOS, ejeXasistido, ejeY1811);

              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.PROFESIONAL, ejeXprofesional, ejeY1811);
            }
          }

          // Se dibuja los datos del cierre
          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.fillText(r.FECHA, ejeXfecha, ejeY1811);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.fillText(r.SUCURSAL, ejeXsucu, ejeY1811);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.CUOTA_SOCIAL, ejeXcuota, ejeY1811);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.TRATAMIENTO, ejeXtrata, ejeY1811);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.COBRADOR, ejeXcobra, ejeY1811);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.VENTA_NUEVA, ejeXventa, ejeY1811);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.MONTO_TOTAL, ejeXmonto, ejeY1811);
        }

        if (r.SUCURSAL == "KM 14 Y MEDIO") {
          // Busca los turnos por sucursal y los dibuja en el canva
          for (let t of losTurnosCantidades) {
            if (r.SUCURSAL == t.SUCURSAL) {
              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.AGENDADOS, ejeXagendado, ejeYkm14);

              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.ASISTIDOS, ejeXasistido, ejeYkm14);

              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.PROFESIONAL, ejeXprofesional, ejeYkm14);
            }
          }

          // Se dibuja los datos del cierre
          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.fillText(r.FECHA, ejeXfecha, ejeYkm14);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.fillText(r.SUCURSAL, ejeXsucu, ejeYkm14);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.CUOTA_SOCIAL, ejeXcuota, ejeYkm14);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.TRATAMIENTO, ejeXtrata, ejeYkm14);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.COBRADOR, ejeXcobra, ejeYkm14);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.VENTA_NUEVA, ejeXventa, ejeYkm14);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.MONTO_TOTAL, ejeXmonto, ejeYkm14);
        }

        if (r.SUCURSAL == "CAPIATA") {
          // Busca los turnos por sucursal y los dibuja en el canva
          for (let t of losTurnosCantidades) {
            if (r.SUCURSAL == t.SUCURSAL) {
              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.AGENDADOS, ejeXagendado, ejeYcap);

              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.ASISTIDOS, ejeXasistido, ejeYcap);

              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.PROFESIONAL, ejeXprofesional, ejeYcap);
            }
          }

          // Se dibuja los datos del cierre
          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.fillText(r.FECHA, ejeXfecha, ejeYcap);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.fillText(r.SUCURSAL, ejeXsucu, ejeYcap);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.CUOTA_SOCIAL, ejeXcuota, ejeYcap);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.TRATAMIENTO, ejeXtrata, ejeYcap);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.COBRADOR, ejeXcobra, ejeYcap);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.VENTA_NUEVA, ejeXventa, ejeYcap);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.MONTO_TOTAL, ejeXmonto, ejeYcap);
        }

        // Zona Ruta 2
        if (r.SUCURSAL == "CAACUPE") {
          // Busca los turnos por sucursal y los dibuja en el canva
          for (let t of losTurnosCantidades) {
            if (r.SUCURSAL == t.SUCURSAL) {
              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.AGENDADOS, ejeXagendado, ejeYcaac);

              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.ASISTIDOS, ejeXasistido, ejeYcaac);

              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.PROFESIONAL, ejeXprofesional, ejeYcaac);
            }
          }

          // Se dibuja los datos del cierre
          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.fillText(r.FECHA, ejeXfecha, ejeYcaac);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.fillText(r.SUCURSAL, ejeXsucu, ejeYcaac);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.CUOTA_SOCIAL, ejeXcuota, ejeYcaac);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.TRATAMIENTO, ejeXtrata, ejeYcaac);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.COBRADOR, ejeXcobra, ejeYcaac);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.VENTA_NUEVA, ejeXventa, ejeYcaac);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.MONTO_TOTAL, ejeXmonto, ejeYcaac);
        }

        if (r.SUCURSAL == "CORONEL OVIEDO") {
          // Busca los turnos por sucursal y los dibuja en el canva
          for (let t of losTurnosCantidades) {
            if (r.SUCURSAL == t.SUCURSAL) {
              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.AGENDADOS, ejeXagendado, ejeYcoro);

              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.ASISTIDOS, ejeXasistido, ejeYcoro);

              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.PROFESIONAL, ejeXprofesional, ejeYcoro);
            }
          }

          // Se dibuja los datos del cierre
          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.fillText(r.FECHA, ejeXfecha, ejeYcoro);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.fillText(r.SUCURSAL, ejeXsucu, ejeYcoro);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.CUOTA_SOCIAL, ejeXcuota, ejeYcoro);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.TRATAMIENTO, ejeXtrata, ejeYcoro);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.COBRADOR, ejeXcobra, ejeYcoro);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.VENTA_NUEVA, ejeXventa, ejeYcoro);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.MONTO_TOTAL, ejeXmonto, ejeYcoro);
        }

        // Zona Itapua
        if (r.SUCURSAL == "HOHENAU") {
          // Busca los turnos por sucursal y los dibuja en el canva
          for (let t of losTurnosCantidades) {
            if (r.SUCURSAL == t.SUCURSAL) {
              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.AGENDADOS, ejeXagendado, ejeYhohe);

              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.ASISTIDOS, ejeXasistido, ejeYhohe);

              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.PROFESIONAL, ejeXprofesional, ejeYhohe);
            }
          }

          // Se dibuja los datos del cierre
          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.fillText(r.FECHA, ejeXfecha, ejeYhohe);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.fillText(r.SUCURSAL, ejeXsucu, ejeYhohe);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.CUOTA_SOCIAL, ejeXcuota, ejeYhohe);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.TRATAMIENTO, ejeXtrata, ejeYhohe);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.COBRADOR, ejeXcobra, ejeYhohe);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.VENTA_NUEVA, ejeXventa, ejeYhohe);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.MONTO_TOTAL, ejeXmonto, ejeYhohe);
        }

        if (r.SUCURSAL == "ENCARNACION CENTRO") {
          // Busca los turnos por sucursal y los dibuja en el canva
          for (let t of losTurnosCantidades) {
            if (r.SUCURSAL == t.SUCURSAL) {
              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.AGENDADOS, ejeXagendado, ejeYencar);

              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.ASISTIDOS, ejeXasistido, ejeYencar);

              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.PROFESIONAL, ejeXprofesional, ejeYencar);
            }
          }

          // Se dibuja los datos del cierre
          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.fillText(r.FECHA, ejeXfecha, ejeYencar);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.fillText(r.SUCURSAL, ejeXsucu, ejeYencar);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.CUOTA_SOCIAL, ejeXcuota, ejeYencar);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.TRATAMIENTO, ejeXtrata, ejeYencar);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.COBRADOR, ejeXcobra, ejeYencar);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.VENTA_NUEVA, ejeXventa, ejeYencar);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.MONTO_TOTAL, ejeXmonto, ejeYencar);
        }

        if (r.SUCURSAL == "MARIA AUXILIADORA") {
          // Busca los turnos por sucursal y los dibuja en el canva
          for (let t of losTurnosCantidades) {
            if (r.SUCURSAL == t.SUCURSAL) {
              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.AGENDADOS, ejeXagendado, ejeYmaria);

              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.ASISTIDOS, ejeXasistido, ejeYmaria);

              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.PROFESIONAL, ejeXprofesional, ejeYmaria);
            }
          }

          // Se dibuja los datos del cierre
          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.fillText(r.FECHA, ejeXfecha, ejeYmaria);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.fillText(r.SUCURSAL, ejeXsucu, ejeYmaria);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.CUOTA_SOCIAL, ejeXcuota, ejeYmaria);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.TRATAMIENTO, ejeXtrata, ejeYmaria);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.COBRADOR, ejeXcobra, ejeYmaria);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.VENTA_NUEVA, ejeXventa, ejeYmaria);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.MONTO_TOTAL, ejeXmonto, ejeYmaria);
        }

        if (r.SUCURSAL == "AYOLAS") {
          // Busca los turnos por sucursal y los dibuja en el canva
          for (let t of losTurnosCantidades) {
            if (r.SUCURSAL == t.SUCURSAL) {
              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.AGENDADOS, ejeXagendado, ejeYayo);

              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.ASISTIDOS, ejeXasistido, ejeYayo);

              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.PROFESIONAL, ejeXprofesional, ejeYayo);
            }
          }

          // Se dibuja los datos del cierre
          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.fillText(r.FECHA, ejeXfecha, ejeYayo);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.fillText(r.SUCURSAL, ejeXsucu, ejeYayo);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.CUOTA_SOCIAL, ejeXcuota, ejeYayo);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.TRATAMIENTO, ejeXtrata, ejeYayo);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.COBRADOR, ejeXcobra, ejeYayo);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.VENTA_NUEVA, ejeXventa, ejeYayo);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.MONTO_TOTAL, ejeXmonto, ejeYayo);
        }

        // Zona Alto Parana
        if (r.SUCURSAL == "KM 7") {
          // Busca los turnos por sucursal y los dibuja en el canva
          for (let t of losTurnosCantidades) {
            if (r.SUCURSAL == t.SUCURSAL) {
              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.AGENDADOS, ejeXagendado, ejeYkm7);

              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.ASISTIDOS, ejeXasistido, ejeYkm7);

              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.PROFESIONAL, ejeXprofesional, ejeYkm7);
            }
          }

          // Se dibuja los datos del cierre
          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.fillText(r.FECHA, ejeXfecha, ejeYkm7);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.fillText(r.SUCURSAL, ejeXsucu, ejeYkm7);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.CUOTA_SOCIAL, ejeXcuota, ejeYkm7);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.TRATAMIENTO, ejeXtrata, ejeYkm7);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.COBRADOR, ejeXcobra, ejeYkm7);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.VENTA_NUEVA, ejeXventa, ejeYkm7);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.MONTO_TOTAL, ejeXmonto, ejeYkm7);
        }

        if (r.SUCURSAL == "SANTA RITA") {
          // Busca los turnos por sucursal y los dibuja en el canva
          for (let t of losTurnosCantidades) {
            if (r.SUCURSAL == t.SUCURSAL) {
              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.AGENDADOS, ejeXagendado, ejeYsanta);

              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.ASISTIDOS, ejeXasistido, ejeYsanta);

              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.PROFESIONAL, ejeXprofesional, ejeYsanta);
            }
          }

          // Se dibuja los datos del cierre
          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.fillText(r.FECHA, ejeXfecha, ejeYsanta);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.fillText(r.SUCURSAL, ejeXsucu, ejeYsanta);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.CUOTA_SOCIAL, ejeXcuota, ejeYsanta);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.TRATAMIENTO, ejeXtrata, ejeYsanta);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.COBRADOR, ejeXcobra, ejeYsanta);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.VENTA_NUEVA, ejeXventa, ejeYsanta);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.MONTO_TOTAL, ejeXmonto, ejeYsanta);
        }

        if (r.SUCURSAL == "CAMPO 9") {
          // Busca los turnos por sucursal y los dibuja en el canva
          for (let t of losTurnosCantidades) {
            if (r.SUCURSAL == t.SUCURSAL) {
              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.AGENDADOS, ejeXagendado, ejeYcampo);

              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.ASISTIDOS, ejeXasistido, ejeYcampo);

              context.font = "bold 15px Arial";
              context.fillStyle = "#34495E";
              context.textAlign = "left";
              context.shadowColor = "red";
              context.fillText(t.PROFESIONAL, ejeXprofesional, ejeYcampo);
            }
          }

          // Se dibuja los datos del cierre
          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.fillText(r.FECHA, ejeXfecha, ejeYcampo);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "left";
          context.fillText(r.SUCURSAL, ejeXsucu, ejeYcampo);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.CUOTA_SOCIAL, ejeXcuota, ejeYcampo);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.TRATAMIENTO, ejeXtrata, ejeYcampo);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.COBRADOR, ejeXcobra, ejeYcampo);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.VENTA_NUEVA, ejeXventa, ejeYcampo);

          context.font = "bold 15px Arial";
          context.fillStyle = "#34495E";
          context.textAlign = "center";
          context.fillText(r.MONTO_TOTAL, ejeXmonto, ejeYcampo);
        }
      }

      // Fila totales ZONA ASUNCION
      // SUM - Monto Total ZONA ASUNCION
      context.font = "bold 15px Arial";
      context.fillStyle = "#34495E";
      context.textAlign = "left";
      context.fillText("ZONA ASUNCIÓN", ejeXsucu, ejeYtotalesAsu);

      context.font = "bold 15px Arial";
      context.fillStyle = "#34495E";
      context.textAlign = "center";
      context.fillText(
        sumTotalesAsuncionCS.toLocaleString("es", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }),
        ejeXcuota,
        ejeYtotalesAsu
      );

      context.font = "bold 15px Arial";
      context.fillStyle = "#34495E";
      context.textAlign = "center";
      context.fillText(
        sumTotalesAsuncionTT.toLocaleString("es", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }),
        ejeXtrata,
        ejeYtotalesAsu
      );

      context.font = "bold 15px Arial";
      context.fillStyle = "#34495E";
      context.textAlign = "center";
      context.fillText(
        sumTotalesAsuncionCO.toLocaleString("es", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }),
        ejeXcobra,
        ejeYtotalesAsu
      );

      context.font = "bold 15px Arial";
      context.fillStyle = "#34495E";
      context.textAlign = "center";
      context.fillText(
        sumTotalesAsuncionVN.toLocaleString("es", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }),
        ejeXventa,
        ejeYtotalesAsu
      );

      // MONTO TOTAL
      context.font = "bold 15px Arial";
      context.fillStyle = "#34495E";
      context.textAlign = "center";
      context.fillText(
        sumTotalesAsuncionMT.toLocaleString("es", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }),
        ejeXmonto,
        ejeYtotalesAsu
      );

      // AGENDADOS
      context.font = "bold 15px Arial";
      context.fillStyle = "#34495E";
      context.textAlign = "left";
      context.fillText(
        sumTotalesAsuncionAG.toLocaleString("es", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }),
        ejeXagendado,
        ejeYtotalesAsu
      );

      context.font = "bold 15px Arial";
      context.fillStyle = "#34495E";
      context.textAlign = "left";
      context.fillText(
        sumTotalesAsuncionAS.toLocaleString("es", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }),
        ejeXasistido,
        ejeYtotalesAsu
      );

      context.font = "bold 15px Arial";
      context.fillStyle = "#34495E";
      context.textAlign = "left";
      context.fillText(
        sumTotalesAsuncionPR.toLocaleString("es", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }),
        ejeXprofesional,
        ejeYtotalesAsu
      );

      // SUM - Monto Total ZONA GRAN ASUNCION
      context.font = "bold 15px Arial";
      context.fillStyle = "#34495E";
      context.textAlign = "left";
      context.fillText("ZONA GRAN ASUNCIÓN", ejeXsucu, ejeYtotalesGranAsu);

      context.font = "bold 15px Arial";
      context.fillStyle = "#34495E";
      context.textAlign = "center";
      context.fillText(
        sumTotalesGAsuncionCS.toLocaleString("es", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }),
        ejeXcuota,
        ejeYtotalesGranAsu
      );

      context.font = "bold 15px Arial";
      context.fillStyle = "#34495E";
      context.textAlign = "center";
      context.fillText(
        sumTotalesGAsuncionTT.toLocaleString("es", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }),
        ejeXtrata,
        ejeYtotalesGranAsu
      );

      context.font = "bold 15px Arial";
      context.fillStyle = "#34495E";
      context.textAlign = "center";
      context.fillText(
        sumTotalesGAsuncionCO.toLocaleString("es", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }),
        ejeXcobra,
        ejeYtotalesGranAsu
      );

      context.font = "bold 15px Arial";
      context.fillStyle = "#34495E";
      context.textAlign = "center";
      context.fillText(
        sumTotalesGAsuncionVN.toLocaleString("es", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }),
        ejeXventa,
        ejeYtotalesGranAsu
      );

      // MONTO TOTAL
      context.font = "bold 15px Arial";
      context.fillStyle = "#34495E";
      context.textAlign = "center";
      context.fillText(
        sumTotalesGAsuncionMT.toLocaleString("es", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }),
        ejeXmonto,
        ejeYtotalesGranAsu
      );

      // AGENDADOS
      context.font = "bold 15px Arial";
      context.fillStyle = "#34495E";
      context.textAlign = "left";
      context.fillText(
        sumTotalesGAsuncionAG.toLocaleString("es", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }),
        ejeXagendado,
        ejeYtotalesGranAsu
      );

      context.font = "bold 15px Arial";
      context.fillStyle = "#34495E";
      context.textAlign = "left";
      context.fillText(
        sumTotalesGAsuncionAS.toLocaleString("es", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }),
        ejeXasistido,
        ejeYtotalesGranAsu
      );

      context.font = "bold 15px Arial";
      context.fillStyle = "#34495E";
      context.textAlign = "left";
      context.fillText(
        sumTotalesGAsuncionPR.toLocaleString("es", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }),
        ejeXprofesional,
        ejeYtotalesGranAsu
      );

      // SUM - Monto Total ZONA RUTA 2
      context.font = "bold 15px Arial";
      context.fillStyle = "#34495E";
      context.textAlign = "left";
      context.fillText("ZONA RUTA 2", ejeXsucu, ejeYtotalesRuta2);

      context.font = "bold 15px Arial";
      context.fillStyle = "#34495E";
      context.textAlign = "center";
      context.fillText(
        sumTotalesR2CS.toLocaleString("es", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }),
        ejeXcuota,
        ejeYtotalesRuta2
      );

      context.font = "bold 15px Arial";
      context.fillStyle = "#34495E";
      context.textAlign = "center";
      context.fillText(
        sumTotalesR2TT.toLocaleString("es", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }),
        ejeXtrata,
        ejeYtotalesRuta2
      );

      context.font = "bold 15px Arial";
      context.fillStyle = "#34495E";
      context.textAlign = "center";
      context.fillText(
        sumTotalesR2CO.toLocaleString("es", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }),
        ejeXcobra,
        ejeYtotalesRuta2
      );

      context.font = "bold 15px Arial";
      context.fillStyle = "#34495E";
      context.textAlign = "center";
      context.fillText(
        sumTotalesR2VN.toLocaleString("es", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }),
        ejeXventa,
        ejeYtotalesRuta2
      );

      // MONTO TOTAL
      context.font = "bold 15px Arial";
      context.fillStyle = "#34495E";
      context.textAlign = "center";
      context.fillText(
        sumTotalesR2MT.toLocaleString("es", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }),
        ejeXmonto,
        ejeYtotalesRuta2
      );

      // AGENDADOS
      context.font = "bold 15px Arial";
      context.fillStyle = "#34495E";
      context.textAlign = "left";
      context.fillText(
        sumTotalesR2AG.toLocaleString("es", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }),
        ejeXagendado,
        ejeYtotalesRuta2
      );

      context.font = "bold 15px Arial";
      context.fillStyle = "#34495E";
      context.textAlign = "left";
      context.fillText(
        sumTotalesR2AS.toLocaleString("es", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }),
        ejeXasistido,
        ejeYtotalesRuta2
      );

      context.font = "bold 15px Arial";
      context.fillStyle = "#34495E";
      context.textAlign = "left";
      context.fillText(
        sumTotalesR2PR.toLocaleString("es", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }),
        ejeXprofesional,
        ejeYtotalesRuta2
      );

      // SUM - Monto Total ZONA ITAPUA
      context.font = "bold 15px Arial";
      context.fillStyle = "#34495E";
      context.textAlign = "left";
      context.fillText("ZONA ITAPUA", ejeXsucu, ejeYtotalesItapua);

      context.font = "bold 15px Arial";
      context.fillStyle = "#34495E";
      context.textAlign = "center";
      context.fillText(
        sumTotalesItaCS.toLocaleString("es", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }),
        ejeXcuota,
        ejeYtotalesItapua
      );

      context.font = "bold 15px Arial";
      context.fillStyle = "#34495E";
      context.textAlign = "center";
      context.fillText(
        sumTotalesItaTT.toLocaleString("es", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }),
        ejeXtrata,
        ejeYtotalesItapua
      );

      context.font = "bold 15px Arial";
      context.fillStyle = "#34495E";
      context.textAlign = "center";
      context.fillText(
        sumTotalesItaCO.toLocaleString("es", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }),
        ejeXcobra,
        ejeYtotalesItapua
      );

      context.font = "bold 15px Arial";
      context.fillStyle = "#34495E";
      context.textAlign = "center";
      context.fillText(
        sumTotalesItaVN.toLocaleString("es", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }),
        ejeXventa,
        ejeYtotalesItapua
      );

      // MONTO TOTAL
      context.font = "bold 15px Arial";
      context.fillStyle = "#34495E";
      context.textAlign = "center";
      context.fillText(
        sumTotalesItaMT.toLocaleString("es", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }),
        ejeXmonto,
        ejeYtotalesItapua
      );

      // AGENDADOS
      context.font = "bold 15px Arial";
      context.fillStyle = "#34495E";
      context.textAlign = "left";
      context.fillText(
        sumTotalesItaAG.toLocaleString("es", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }),
        ejeXagendado,
        ejeYtotalesItapua
      );

      context.font = "bold 15px Arial";
      context.fillStyle = "#34495E";
      context.textAlign = "left";
      context.fillText(
        sumTotalesItaAS.toLocaleString("es", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }),
        ejeXasistido,
        ejeYtotalesItapua
      );

      context.font = "bold 15px Arial";
      context.fillStyle = "#34495E";
      context.textAlign = "left";
      context.fillText(
        sumTotalesItaPR.toLocaleString("es", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }),
        ejeXprofesional,
        ejeYtotalesItapua
      );

      // SUM - Monto Total ZONA ALTO PARANA
      context.font = "bold 15px Arial";
      context.fillStyle = "#34495E";
      context.textAlign = "left";
      context.fillText("ZONA ALTO PARANA", ejeXsucu, ejeYtotalesAltoP);

      context.font = "bold 15px Arial";
      context.fillStyle = "#34495E";
      context.textAlign = "center";
      context.fillText(
        sumTotalesApCS.toLocaleString("es", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }),
        ejeXcuota,
        ejeYtotalesAltoP
      );

      context.font = "bold 15px Arial";
      context.fillStyle = "#34495E";
      context.textAlign = "center";
      context.fillText(
        sumTotalesApTT.toLocaleString("es", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }),
        ejeXtrata,
        ejeYtotalesAltoP
      );

      context.font = "bold 15px Arial";
      context.fillStyle = "#34495E";
      context.textAlign = "center";
      context.fillText(
        sumTotalesApCO.toLocaleString("es", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }),
        ejeXcobra,
        ejeYtotalesAltoP
      );

      context.font = "bold 15px Arial";
      context.fillStyle = "#34495E";
      context.textAlign = "center";
      context.fillText(
        sumTotalesApVN.toLocaleString("es", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }),
        ejeXventa,
        ejeYtotalesAltoP
      );

      // MONTO TOTAL
      context.font = "bold 15px Arial";
      context.fillStyle = "#34495E";
      context.textAlign = "center";
      context.fillText(
        sumTotalesApMT.toLocaleString("es", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }),
        ejeXmonto,
        ejeYtotalesAltoP
      );

      // AGENDADOS
      context.font = "bold 15px Arial";
      context.fillStyle = "#34495E";
      context.textAlign = "left";
      context.fillText(
        sumTotalesApAG.toLocaleString("es", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }),
        ejeXagendado,
        ejeYtotalesAltoP
      );

      context.font = "bold 15px Arial";
      context.fillStyle = "#34495E";
      context.textAlign = "left";
      context.fillText(
        sumTotalesApAS.toLocaleString("es", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }),
        ejeXasistido,
        ejeYtotalesAltoP
      );

      context.font = "bold 15px Arial";
      context.fillStyle = "#34495E";
      context.textAlign = "left";
      context.fillText(
        sumTotalesApPR.toLocaleString("es", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }),
        ejeXprofesional,
        ejeYtotalesAltoP
      );

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

    console.log("Fin del envío del reporte");
    // console.log("Luego de 1m se vuelve a consultar al PGSQL");
    // setTimeout(() => {
    //   //iniciarEnvio();
    // }, 10000);
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