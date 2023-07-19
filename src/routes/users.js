var CryptoJS = require("crypto-js");
module.exports = (app) => {
  const Users = app.db.models.Users;

  app
    .route("/users")
    .get((req, res) => {
      Users.findAll()
        .then((result) => res.json(result))
        .catch((error) => {
          res.status(402).json({
            msg: error.menssage,
          });
        });
    })
    .post((req, res) => {
      console.log(req.body);

      // Receiving data
      const { user_name, user_password, user_email, user_fullname, role_id } =
        req.body;

      if (user_password === "") {
        res.json({error: 'La contraseña no puede estar vacia!'})
        return
      }
      
      // Creating new user
      const user = {
        user_name: user_name,
        user_password: user_password,
        user_email: user_email,
        user_fullname: user_fullname,
        role_id: role_id,
      };
      // Encrypting password
      user.user_password = CryptoJS.AES.encrypt(
        user.user_password,
        "secret"
      ).toString();
      // Insert new user
      Users.create(user)
        .then((result) => res.json(result))
        .catch((error) => res.json(error));
    });

  app
    .route("/users/:user_id")
    .get((req, res) => {
      Users.findOne({
        where: req.params,
      })
        .then((result) => res.json(result))
        .catch((error) => {
          res.status(404).json({
            msg: error.message,
          });
        });
    })
    .put((req, res) => {
      Users.update(req.body, {
        where: req.params,
      })
        .then((result) => res.sendStatus(204))
        .catch((error) => {
          res.status(412).json({
            msg: error.message,
          });
        });
    })
    .delete((req, res) => {
      //const id = req.params.id;
      Users.destroy({
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
