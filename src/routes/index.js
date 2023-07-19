module.exports = (app) => {
    const htmlBody = `
    <div style="text-align: center;">
    <h1>ERROR 404</h1>
    <br>
    <img src="http://i.stack.imgur.com/SBv4T.gif" alt="I choose you!"  width="250" />
    <br>
    <h1>Page not found</h1>
    </div>
    `;
    app.get("/", (req, res) => {
      res.status(404).send(htmlBody);
      //res.json({message: "ODONTOS - Metrepay - EndPoint API"})
    });
  
    app.route("/api").get((req, res) => {
      res.status(404).send(htmlBody);
      //res.json({message: "ODONTOS - Metrepay - EndPoint API"})
    });
  };