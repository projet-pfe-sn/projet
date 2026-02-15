// ========================================
// INSCRIPTION ET LOGIN (à copier dans app.js)
// ========================================

// ——————————————————————————
// INSCRIPTION TOURISTE
// ——————————————————————————

app.get("/register", (req, res) => {
  res.render("auth/register");
});

app.post("/register", async (req, res) => {

  const {
    nom_complet,
    email,
    mot_de_passe,
    telephone,
    nationalite,
    role,
    admin_code
  } = req.body;

  // Protection Admin
  if (role === "ADMIN") {
    if (admin_code !== "ADMINE123") {
      return res.render("auth/register", {
        error: "Code Admin incorrect"
      });
    }
  }

  if (!email || !mot_de_passe) {
    return res.render("auth/register", {
      error: "Email et mot de passe requis"
    });
  }

  try {

    const hashed = await bcrypt.hash(mot_de_passe, 10);

    db.query(
      "INSERT INTO utilisateurs (nom_complet, email, mot_de_passe, role, est_actif) VALUES (?, ?, ?, ?, 1)",
      [nom_complet, email, hashed, role],
      (err, result) => {

        if (err) {
          console.error(err);
          return res.render("auth/register", {
            error: "Email déjà utilisé"
          });
        }

        const id = result.insertId;

        // TOURISTE
        if (role === "TOURISTE") {

          db.query(
            "INSERT INTO touristes (id_utilisateur, nationalite, telephone) VALUES (?, ?, ?)",
            [id, nationalite, telephone],
            () => res.redirect("/login")
          );

        }

        // GUIDE
        else if (role === "GUIDE") {

          db.query(
            "INSERT INTO guides (id_utilisateur, cv, statut) VALUES (?, NULL, 'ACTIF')",
            [id],
            () => res.redirect("/login")
          );

        }

        // ADMIN
        else if (role === "ADMIN") {

          // ما عندو table خاصة
          res.redirect("/login");

        }

      }
    );

  } catch (e) {
    console.log(e);
    res.render("auth/register", {
      error: "Erreur serveur"
    });
  }

});


// ——————————————————————————
// LOGIN
// ——————————————————————————

app.get("/login", (req, res) => {
  res.render("auth/login");
});

app.post("/login", (req, res) => {
  const { email, mot_de_passe } = req.body;

  db.query(
    "SELECT * FROM utilisateurs WHERE email = ?",
    [email],
    (err, rows) => {
      if (err) {
        console.error("ERREUR login:", err);
        return res.status(500).send("Erreur serveur");
      }

      if (!rows || rows.length !== 1) {
        return res.render("auth/login", { error: "Email ou mot de passe incorrect" });
      }

      const user = rows[0];
      if (!bcrypt.compareSync(mot_de_passe, user.mot_de_passe)) {
        return res.render("auth/login", { error: "Mot de passe incorrect" });
      }

      req.session.user = user;

      if      (user.role === 'TOURISTE') { res.redirect("/"); }
      else if (user.role === 'GUIDE')    { res.redirect("/guide/dashboard");  }
      else                               { res.redirect("/admin/dashboard");  }
    }
  );
});

app.get("/logout", (req, res) => {
  req.session.destroy(()=>{
    res.redirect("/login");
  });
});

// ========================================
// FIN DES ROUTES D'AUTHENTIFICATION
// ========================================
