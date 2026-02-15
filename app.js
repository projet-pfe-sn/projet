const express   = require('express');
const { engine } = require('express-handlebars');
const path      = require('path');
const bcrypt    = require('bcryptjs');
const session   = require('express-session');
const multer    = require('multer');
const Handlebars = require('handlebars');

// Import routes
const adminRoutes = require('./routes/admin');
const guideRoutes = require('./routes/guide');
const indexRoutes = require('./routes/index');
const plansRoutes = require('./routes/plans');
const messagerieRoutes = require('./routes/messagerie');

const hbs = engine({
  extname: '.hbs',
  defaultLayout: 'main',
  handlebars: Handlebars,
  //
  
});

const app = express();

// ——————————————————————————
// MULTER CONFIG (CV Upload)
// ——————————————————————————

// Stockage CV dans public/cvs/
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/cvs/'); // dossier cvs
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + req.session.user?.id + '-' + file.originalname);
  }
});

const uploadCV = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Seulement PDF acceptés'), false);
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB max
});

// ——————————————————————————
// VIEW ENGINE
// ——————————————————————————

app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));

app.engine('hbs', engine({
  extname: '.hbs',
  defaultLayout: 'main'
}));

// ——————————————————————————
// MIDDLEWARES
// ——————————————————————————

// Middleware: vérifier si guide validé
const checkGuideValidated = (req, res, next) => {
  if (req.session.user?.role !== 'GUIDE') return res.redirect("/login");

  db.query(
    "SELECT cv_approved FROM guides WHERE id_utilisateur = ?",
    [req.session.user.id],
    (err, rows) => {
      if (err || rows.length === 0 || !rows[0].cv_approved) {
        return res.status(403).render("guide/non-valide", {
          user: req.session.user,
          message: "Votre CV doit être approuvé par l'administrateur avant de créer des plans"
        });
      }
      next();
    }
  );
};

app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: 'insideTunisiaSecret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 3600000 }
}));

// Connexion base via config/db.js (tu l’as cool dis!)
const db = require('./config/db');

// ——————————————————————————
// ROUTE PRINCIPALE: accueil
// ——————————————————————————

app.get("/", (req, res) => {
  db.query("SELECT * FROM gouvernorats", (err, rows) => {
    if (err) {
      console.error("Erreur DB:", err);
      return res.status(500).send("Erreur serveur");
    }
    res.render("accueil", { gouvernorats: rows });
  });
});

// ——————————————————————————
// INSCRIPTION TOURISTE
// ——————————————————————————

app.get("/register", (req, res) => {
  res.render("auth/register", { error: null });
});

// ========================================
// SYSTÈME INSCRIPTION GUIDE → ADMIN → PAIEMENT
// ========================================

// 1️⃣ INSCRIPTION GUIDE (notification auto admin)
app.post("/register", uploadCV.single('cv'), (req, res) => {
  const { nom_complet, email, mot_de_passe, role, telephone, admin_code } = req.body;
  const hashedPassword = bcrypt.hashSync(mot_de_passe, 10);

  // Protection Admin
  if (role === "ADMIN") {
    if (admin_code !== "ADMINE123") {
      return res.render("auth/register", {
        error: "Code Admin incorrect"
      });
    }
  }

  db.query("SELECT id FROM utilisateurs WHERE email = ?", [email], (err, rows) => {
    if (rows.length > 0) {
      return res.render("auth/register", { error: "Email déjà utilisé" });
    }

    db.query(
      "INSERT INTO utilisateurs (nom_complet, email, mot_de_passe, role) VALUES (?, ?, ?, ?)",
      [nom_complet, email, hashedPassword, role],
      (err, result) => {
        const id_utilisateur = result.insertId;

        if (role === "GUIDE") {
          const cv_path = req.file ? req.file.path.replace('public/', '') : null;
          
          // ✅ INSERT GUIDE avec cv_approved = 0 (en attente)
          db.query(
            "INSERT INTO guides (id_utilisateur, cv, cv_approved, statut) VALUES (?, ?, 0, 'EN_ATTENTE')",
            [id_utilisateur, cv_path]
          );

          // 🚨 NOTIFICATION AUTO À L'ADMIN (id=13 saharr)
          const notificationContent = `Nouveau guide inscrit: ${nom_complet} (ID: ${id_utilisateur})`;
          db.query(
            "INSERT INTO notifications (id_utilisateur, type, contenu) VALUES (13, 'CV', ?)",
            [notificationContent]
          );
        }

        res.redirect("/login?success=inscription");
      }
    );
  });
});

// 2️⃣ ADMIN APPROUVE CV → NOTIFICATION GUIDE
app.post("/admin/cv/:id/approve", (req, res) => {
  if (!req.session.user || req.session.user.role !== "ADMIN") {
    return res.status(403).send("Accès refusé");
  }

  const id_guide = req.params.id;

  db.query(
    "UPDATE guides SET cv_approved = 1, statut = 'ACTIF' WHERE id_utilisateur = ?",
    [id_guide],
    (err) => {
      if (err) return res.status(500).send("Erreur");

      // ✅ NOTIFICATION AU GUIDE : "Payez pour activer"
      db.query(
        "INSERT INTO notifications (id_utilisateur, type, contenu) VALUES (?, 'ABONNEMENT', '✅ CV approuvé ! Payez votre abonnement pour créer des plans touristiques.')",
        [id_guide]
      );

      res.redirect("/admin/dashboard");
    }
  );
});

// 3️⃣ GUIDE PAYER PAR CARTE (API Stripe simulée)
app.post("/guide/abonnement/payer", (req, res) => {
  if (!req.session.user || req.session.user.role !== "GUIDE") {
    return res.status(403).send("Accès refusé");
  }

  const id_guide = req.session.user.id;

  // Vérifier si CV approuvé
  db.query("SELECT cv_approved FROM guides WHERE id_utilisateur = ?", [id_guide], (err, rows) => {
    if (rows[0].cv_approved === 0) {
      return res.render("guide/dashboard", { error: "Votre CV doit être approuvé d'abord" });
    }

    // ✅ SIMULATION PAIEMENT CARTE (ici tu intègres Stripe)
    const abonnement_id = Date.now(); // ID unique
    
    db.query(
      "INSERT INTO abonnements (id_guide, date_debut, date_fin, statut) VALUES (?, CURDATE(), DATE_ADD(CURDATE(), INTERVAL 1 MONTH), 'ACTIF')",
      [id_guide]
    );

    db.query(
      "UPDATE guides SET abonnement_actif = 1 WHERE id_utilisateur = ?",
      [id_guide]
    );

    // ✅ GUIDE MAINTENANT ACTIF COMPLÈTEMENT
    req.flash("success", "Abonnement activé ! Créez vos plans touristiques.");
    res.redirect("/guide/dashboard");
  });
});

// 4️⃣ BLOQUER GUIDE (Admin)
app.post("/admin/guide/:id/bloquer", (req, res) => {
  const id_guide = req.params.id;
  db.query("UPDATE guides SET statut = 'BLOQUE' WHERE id_utilisateur = ?", [id_guide], (err) => {
    res.redirect("/admin/dashboard");
  });
});

// 5️⃣ DASHBOARD GUIDE (bloqué si pas payé)
app.get("/guide/dashboard", (req, res) => {
  if (!req.session.user || req.session.user.role !== "GUIDE") {
    return res.redirect("/login");
  }

  const id_guide = req.session.user.id;

  db.query(`
    SELECT g.*, u.nom_complet 
    FROM guides g JOIN utilisateurs u ON g.id_utilisateur = u.id 
    WHERE g.id_utilisateur = ?
  `, [id_guide], (err, guideInfo) => {
    
    const guide = guideInfo[0];

    if (!guide || guide.statut === 'EN_ATTENTE') {
      return res.render("guide/en-attente", { 
        user: req.session.user, 
        message: "Votre CV est en cours d'examen par l'admin" 
      });
    }

    if (!guide.cv_approved) {
      return res.render("guide/dashboard", { 
        user: req.session.user, 
        error: "Votre CV doit être approuvé par l'admin" 
      });
    }

    if (!guide.abonnement_actif) {
      return res.render("guide/dashboard", { 
        user: req.session.user, 
        error: "Payez votre abonnement pour créer des plans",
        showPaymentBtn: true
      });
    }

    // ✅ GUIDE COMPLÈTEMENT ACTIF
    db.query("SELECT COUNT(*) as nb_plans FROM plans_touristiques WHERE id_guide = ?", [id_guide], (err, stats) => {
      res.render("guide/dashboard", {
        user: req.session.user,
        guide,
        nb_plans: stats[0].nb_plans,
        actif: true
      });
    });
  });
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

// ———————————————————
// DASHBOARD TOURISTE
// ———————————————————

app.get("/touriste/dashboard", (req, res) => {
  if (!req.session.user || req.session.user.role !== "TOURISTE") {
    return res.redirect("/login");
  }

  db.query("SELECT * FROM plans_touristiques", (err, plans) => {
    if (err) {
      console.error("ERREUR plans_touristiques:", err);
      return res.status(500).send("Erreur serveur");
    }

    res.render("touriste/dashboard", {
      user: req.session.user,
      plans
    });
  });
});

// ———————————————————
// GUIDE DASHBOARD
// ———————————————————

// Dashboard Guide - Liste ses plans + stats
app.get("/guide/dashboard", (req, res) => {
  // Vérifier que c'est un guide connecté
  if (!req.session.user || req.session.user.role !== "GUIDE") {
    return res.redirect("/login");
  }

  const id_guide = req.session.user.id;

  db.query(`
    SELECT COUNT(*) as nb_plans 
    FROM plans_touristiques 
    WHERE id_guide = ?
  `, [id_guide], (err1, stats) => {
    if (err1) {
      console.error("Erreur stats guide:", err1);
      return res.status(500).send("Erreur serveur");
    }

    db.query(`
      SELECT p.*, g.nom_complet as nom_guide
      FROM plans_touristiques p 
      JOIN utilisateurs g ON p.id_guide = g.id 
      WHERE p.id_guide = ?
      ORDER BY p.date_debut DESC 
      LIMIT 5
    `, [id_guide], (err2, plans) => {
      if (err2) {
        console.error("Erreur plans guide:", err2);
        return res.status(500).send("Erreur serveur");
      }

      res.render("guide/dashboard", {
        user: req.session.user,
        nb_plans: stats[0].nb_plans,
        plans: plans
      });
    });
  });
});

// Guide plans list
app.get("/guide/plans", checkGuideValidated, (req, res) => {
  const id_guide = req.session.user.id;

  db.query(
    "SELECT * FROM plans_touristiques WHERE id_guide = ? ORDER BY date_debut DESC",
    [id_guide],
    (err, plans) => {
      if (err) {
        console.error("Erreur plans_touristiques:", err);
        return res.status(500).send("Erreur serveur");
      }

      res.render("guide/plans", {
        user: req.session.user,
        plans
      });
    }
  );
});

// Create new plan form
app.get("/guide/plans/new", checkGuideValidated, (req, res) => {
  res.render("guide/create-plan", {
    user: req.session.user
  });
});

// Create new plan
app.post("/guide/plans", checkGuideValidated, (req, res) => {
  const { titre, description, date_debut, date_fin, prix } = req.body;
  const id_guide = req.session.user.id;

  db.query(
    "INSERT INTO plans_touristiques (id_guide, titre, description, date_debut, date_fin, prix) VALUES (?, ?, ?, ?, ?, ?)",
    [id_guide, titre, description, date_debut, date_fin, prix],
    (err, result) => {
      if (err) {
        console.error("ERREUR création plan:", err);
        return res.status(500).send("Erreur création plan");
      }
      res.redirect("/guide/plans");
    }
  );
});

// Profil Guide - Modifier infos + CV + statut
app.get("/guide/profile", (req, res) => {
  if (!req.session.user || req.session.user.role !== "GUIDE") {
    return res.redirect("/login");
  }

  const id_guide = req.session.user.id;

  // Récupérer infos guide + CV + abonnement
  db.query(`
    SELECT u.*, g.cv, g.cv_approved, g.abonnement_actif, g.abonnement_fin
    FROM utilisateurs u 
    LEFT JOIN guides g ON u.id = g.id_utilisateur
    WHERE u.id = ?
  `, [id_guide], (err, rows) => {
    if (err) {
      console.error("Erreur profil guide:", err);
      return res.status(500).send("Erreur serveur");
    }

    if (rows.length === 0) {
      return res.status(404).send("Profil introuvable");
    }

    const guide = rows[0];

    res.render("guide/profile", {
      user: req.session.user,
      guide: guide
    });
  });
});

// Route UPDATE profil (bonus)
app.post("/guide/profile/update", (req, res) => {
  if (!req.session.user || req.session.user.role !== "GUIDE") {
    return res.redirect("/login");
  }

  const { telephone, bio } = req.body;
  const id_guide = req.session.user.id;

  db.query(
    "UPDATE utilisateurs SET telephone = ?, bio = ? WHERE id = ?",
    [telephone, bio || null, id_guide],
    (err) => {
      if (err) {
        console.error("Erreur update profil:", err);
        return res.status(500).send("Erreur serveur");
      }

      res.redirect("/guide/profile");
    }
  );
});

// Guide subscription page
app.get("/guide/abonnement", (req, res) => {
  if (!req.session.user || req.session.user.role !== "GUIDE") {
    return res.redirect("/login");
  }

  // Get guide's subscription info
  db.query(
    "SELECT abonnement_actif, abonnement_fin FROM guides WHERE id_utilisateur = ?",
    [req.session.user.id],
    (err, result) => {
      if (err) {
        console.error("ERREUR abonnement:", err);
        return res.status(500).send("Erreur serveur");
      }

      const guideData = result[0] || {};
      const userWithSub = {
        ...req.session.user,
        abonnement_actif: guideData.abonnement_actif || 0,
        abonnement_fin: guideData.abonnement_fin
      };

      res.render("guide/abonnement", {
        user: userWithSub
      });
    }
  );
});

// Guide activate subscription (simulation)
app.post("/guide/abonnement/activer", (req, res) => {
  if (!req.session.user || req.session.user.role !== 'GUIDE') return res.status(403);

  // Ici tu intègres Stripe/PayPal
  const id_guide = req.session.user.id;

  db.query(
    "UPDATE guides SET abonnement_actif = 1, abonnement_fin = DATE_ADD(NOW(), INTERVAL 1 MONTH) WHERE id_utilisateur = ?",
    [id_guide],
    (err) => {
      if (err) {
        console.error("ERREUR activation abonnement:", err);
        return res.status(500).send("Erreur activation abonnement");
      }
      res.redirect("/guide/abonnement");
    }
  );
});

// ———————————————————
// ADMIN DASHBOARD
// ———————————————————

app.get("/admin/dashboard", (req, res) => {
  if (!req.session.user || req.session.user.role !== "ADMIN") {
    return res.redirect("/login");
  }

  // Get statistics
  db.query(`
    SELECT 
      (SELECT COUNT(*) FROM touristes) as touristes,
      (SELECT COUNT(*) FROM guides) as guides,
      (SELECT COUNT(*) FROM plans_touristiques) as plans,
      (SELECT COUNT(*) FROM guides WHERE cv_approved = 0) as cvAttente
  `, (err, stats) => {
    if (err) {
      console.error("ERREUR stats admin:", err);
      stats = [{ touristes: 0, guides: 0, plans: 0, cvAttente: 0 }];
    }

    res.render("admin/dashboard", {
      user: req.session.user,
      stats: stats[0]
    });
  });
});

// Admin liste les CV en attente
app.get("/admin/cv-attente", (req, res) => {
  if (!req.session.user || req.session.user.role !== 'ADMIN') {
    return res.redirect("/login");
  }

  db.query(`
    SELECT u.nom_complet, g.id_utilisateur, g.cv 
    FROM guides g 
    JOIN utilisateurs u ON g.id_utilisateur = u.id 
    WHERE g.cv_approved = 0
  `, (err, cvs) => {
    if (err) {
      console.error("ERREUR cv attente:", err);
      cvs = [];
    }
    res.render("admin/cv-attente", { 
      user: req.session.user,
      cvs 
    });
  });
});

// Admin approuve CV
app.post("/admin/cv/:id/approve", (req, res) => {
  if (!req.session.user || req.session.user.role !== 'ADMIN') return res.status(403).send("Accès refusé");

  const id_guide = req.params.id;

  db.query(
    "UPDATE guides SET cv_approved = 1, date_validation = NOW() WHERE id_utilisateur = ?",
    [id_guide],
    (err) => {
      if (err) {
        console.error("ERREUR validation CV:", err);
        return res.status(500).send("Erreur validation");
      }

      // Notification au guide
      db.query(
        "INSERT INTO notifications (id_utilisateur, type, contenu) VALUES (?, 'CV', 'Votre CV a été approuvé!')",
        [id_guide],
        (notifErr) => {
          if (notifErr) console.error("ERREUR notification:", notifErr);
        }
      );

      res.redirect("/admin/cv-attente");
    }
  );
});

// ——————————————————————————
// ROUTES ADMIN COMPLETES
// ——————————————————————————

// Dashboard Admin - Liste guides + onglets
app.get("/admin/dashboard", (req, res) => {
  if (!req.session.user || req.session.user.role !== "ADMIN") {
    return res.redirect("/login");
  }

  const adminId = req.session.user.id;

  // Stats complètes
  db.query(`
    SELECT 
      (SELECT COUNT(*) FROM guides WHERE cv_approved = 1 OR statut = 'ACTIF') as guides_actifs,
      (SELECT COUNT(*) FROM guides g JOIN utilisateurs u ON g.id_utilisateur = u.id WHERE g.cv_approved = 0 AND g.cv IS NOT NULL) as guides_en_attente,
      (SELECT COUNT(*) FROM notifications WHERE id_utilisateur = ? AND est_vu = 0) as notifications_non_lues,
      (SELECT COUNT(*) FROM plans_touristiques) as total_plans
  `, [adminId], (err, stats) => {

    // Guides actifs avec nombre de plans
    db.query(`
      SELECT u.*, g.cv_approved, g.statut, g.abonnement_actif, LEFT(u.nom_complet, 1) as avatar_letter,
             (SELECT COUNT(*) FROM plans_touristiques WHERE id_guide = u.id) as nb_plans
      FROM utilisateurs u JOIN guides g ON u.id = g.id_utilisateur
      WHERE u.role = 'GUIDE' AND g.statut = 'ACTIF'
      ORDER BY g.date_validation DESC LIMIT 10
    `, (err2, guides_actifs) => {

      // Guides en attente
      db.query(`
        SELECT u.*, g.cv, LEFT(u.nom_complet, 1) as avatar_letter
        FROM utilisateurs u JOIN guides g ON u.id = g.id_utilisateur
        WHERE u.role = 'GUIDE' AND g.cv_approved = 0 AND g.cv IS NOT NULL
        ORDER BY u.date_creation DESC
      `, (err3, guides_attente) => {

        // Notifications
        db.query(
          "SELECT * FROM notifications WHERE id_utilisateur = ? ORDER BY date_creation DESC LIMIT 10",
          [adminId], (err4, notifications) => {
            res.render("admin/dashboard", {
              user: req.session.user,
              stats: stats[0],
              guides_actifs,
              guides_attente,
              notifications
            });
          }
        );
      });
    });
  });
});

// Valider CV Guide
app.post("/admin/cv/:id/approve", (req, res) => {
  if (!req.session.user || req.session.user.role !== "ADMIN") {
    return res.status(403).send("Accès refusé");
  }

  const id_guide = req.params.id;

  db.query(
    "UPDATE guides SET cv_approved = 1, date_validation = NOW(), statut = 'ACTIF' WHERE id_utilisateur = ?",
    [id_guide],
    (err) => {
      if (err) return res.status(500).send("Erreur validation");

      // Notification au guide
      db.query(
        "INSERT INTO notifications (id_utilisateur, type, contenu, est_vu) VALUES (?, 'CV', 'Votre CV a été approuvé !', 0)",
        [id_guide]
      );

      res.redirect("/admin/dashboard");
    }
  );
});

// Bloquer/Débloquer Guide
app.post("/admin/guide/:id/:action", (req, res) => {
  if (!req.session.user || req.session.user.role !== "ADMIN") {
    return res.status(403).send("Accès refusé");
  }

  const id_guide = req.params.id;
  const action = req.params.action; // 'bloquer' ou 'activer'

  const newStatut = action === 'bloquer' ? 'BLOQUE' : 'ACTIF';

  db.query(
    "UPDATE guides SET statut = ? WHERE id_utilisateur = ?",
    [newStatut, id_guide],
    (err) => {
      if (err) return res.status(500).send("Erreur statut");
      res.redirect("/admin/dashboard");
    }
  );
});

// ========================================
// MESSAGERIE ADMIN ↔ GUIDE
// ========================================

// Page Messagerie Admin
app.get("/admin/messages", (req, res) => {
  if (!req.session.user || req.session.user.role !== "ADMIN") {
    return res.redirect("/login");
  }

  const adminId = req.session.user.id;

  db.query(`
    SELECT DISTINCT u.id, u.nom_complet, u.email,
           (SELECT COUNT(*) FROM messages m WHERE m.id_destinataire = ? AND m.id_expediteur = u.id AND m.est_lu = 0) as unread
    FROM utilisateurs u 
    LEFT JOIN messages m ON (m.id_expediteur = u.id OR m.id_destinataire = u.id)
    WHERE u.role = 'GUIDE' AND (m.id_destinataire = ? OR m.id_expediteur = ?)
    GROUP BY u.id
    ORDER BY unread DESC, u.nom_complet
  `, [adminId, adminId, adminId], (err, guides) => {

    res.render("admin/messages", {
      user: req.session.user,
      guides
    });
  });
});

// Conversation spécifique Admin ↔ Guide
app.get("/admin/messages/:guideId", (req, res) => {
  const adminId = req.session.user.id;
  const guideId = req.params.guideId;

  // Marquer messages comme lus
  db.query("UPDATE messages SET est_lu = 1 WHERE id_destinataire = ? AND id_expediteur = ?", [adminId, guideId]);

  db.query(`
    SELECT m.*, u.nom_complet 
    FROM messages m 
    JOIN utilisateurs u ON m.id_expediteur = u.id
    WHERE (m.id_expediteur = ? AND m.id_destinataire = ?) OR (m.id_expediteur = ? AND m.id_destinataire = ?)
    ORDER BY m.date_creation ASC
  `, [adminId, guideId, guideId, adminId], (err, messages) => {

    db.query("SELECT * FROM utilisateurs WHERE id = ?", [guideId], (err2, guide) => {
      res.render("admin/conversation", {
        user: req.session.user,
        guide: guide[0],
        messages
      });
    });
  });
});

// Envoyer message
app.post("/admin/messages/:guideId", (req, res) => {
  const adminId = req.session.user.id;
  const guideId = req.params.guideId;
  const { contenu } = req.body;

  db.query(
    "INSERT INTO messages (id_expediteur, id_destinataire, contenu) VALUES (?, ?, ?)",
    [adminId, guideId, contenu],
    (err) => {
      // Notification au guide
      db.query(
        "INSERT INTO notifications (id_utilisateur, type, contenu) VALUES (?, 'MESSAGE', 'Nouveau message de l\\'admin')",
        [guideId]
      );
      res.redirect(`/admin/messages/${guideId}`);
    }
  );
});

// Guide reçoit messages (dashboard)
app.get("/guide/messages", (req, res) => {
  if (!req.session.user || req.session.user.role !== "GUIDE") {
    return res.redirect("/login");
  }

  const guideId = req.session.user.id;

  db.query(`
    SELECT m.*, u.nom_complet as admin_name
    FROM messages m 
    JOIN utilisateurs u ON m.id_expediteur = u.id
    WHERE m.id_destinataire = ?
    ORDER BY m.date_creation DESC
  `, [guideId], (err, messages) => {
    res.render("guide/messages", {
      user: req.session.user,
      messages
    });
  });
});

app.get("/guide/dashboard", (req, res) => {
  if (!req.session.user || req.session.user.role !== "GUIDE") {
    return res.redirect("/login");
  }

  const id_guide = req.session.user.id;

  db.query(`
    SELECT u.*, g.cv, g.statut, g.cv_approved, g.abonnement_actif
    FROM utilisateurs u 
    LEFT JOIN guides g ON u.id = g.id_utilisateur 
    WHERE u.id = ?
  `, [id_guide], (err, guideInfo) => {
    const guide = guideInfo[0];
    
    res.render("guide/dashboard", {
      user: req.session.user,
      cv_approved: guide ? guide.cv_approved : false,      // ✅ Correct
      abonnement_actif: guide ? guide.abonnement_actif : false, // ✅ Correct
      statut: guide ? guide.statut : 'EN_ATTENTE'
    });
  });
});

// Mark notifications as read
app.post("/guide/notifications/read", (req, res) => {
  if (!req.session.user || req.session.user.role !== "GUIDE") {
    return res.status(403).json({ error: "Accès refusé" });
  }

  const guideId = req.session.user.id;
  
  db.query(
    "UPDATE notifications SET est_vu = 1 WHERE id_utilisateur = ?",
    [guideId],
    (err) => {
      if (err) return res.status(500).json({ error: "Erreur serveur" });
      res.json({ success: true });
    }
  );
});

// Refresh notifications count
app.get("/guide/notifications/refresh", (req, res) => {
  if (!req.session.user || req.session.user.role !== "GUIDE") {
    return res.status(403).json({ error: "Accès refusé" });
  }

  const guideId = req.session.user.id;
  
  db.query(
    "SELECT COUNT(*) as notifications_count FROM notifications WHERE id_utilisateur = ? AND est_vu = 0",
    [guideId],
    (err, result) => {
      if (err) return res.status(500).json({ error: "Erreur serveur" });
      res.json({ notifications_count: result[0].notifications_count });
    }
  );
});

// Refresh messages endpoint
app.get("/admin/messages/:guideId/refresh", (req, res) => {
  if (!req.session.user || req.session.user.role !== "ADMIN") {
    return res.status(403).json({ error: "Accès refusé" });
  }

  const adminId = req.session.user.id;
  const guideId = req.params.guideId;
  
  db.query(`
    SELECT m.*, u.nom_complet 
    FROM messages m 
    JOIN utilisateurs u ON m.id_expediteur = u.id
    WHERE (m.id_expediteur = ? AND m.id_destinataire = ?) OR (m.id_expediteur = ? AND m.id_destinataire = ?)
    ORDER BY m.date_creation ASC
  `, [adminId, guideId, guideId, adminId], (err, messages) => {
    if (err) return res.status(500).json({ error: "Erreur serveur" });
    res.json(messages);
  });
});

// Guide send message to admin
app.post("/guide/messages", (req, res) => {
  if (!req.session.user || req.session.user.role !== "GUIDE") {
    return res.status(403).send("Accès refusé");
  }

  const { adminId, contenu } = req.body;
  const guideId = req.session.user.id;
  
  if (!contenu) {
    return res.status(400).send("Contenu requis");
  }
  
  db.query(
    "INSERT INTO messages (id_expediteur, id_destinataire, contenu) VALUES (?, ?, ?)",
    [guideId, adminId, contenu],
    (err) => {
      if (err) return res.status(500).send("Erreur envoi");
      
      // Notification à l'admin
      db.query(
        "INSERT INTO notifications (id_utilisateur, type, contenu) VALUES (?, 'MESSAGE', 'Message du guide: ' + LEFT(?, 50) + '...')",
        [adminId, contenu]
      );
      
      res.redirect("/guide/messages");
    }
  );
});

// Initialize routes
adminRoutes(app, db);
guideRoutes(app, db);
indexRoutes(app, db);
plansRoutes(app, db);
messagerieRoutes(app, db);

// 404 Handler
app.use((req, res, next) => {
  res.status(404).render('404', { url: req.originalUrl });
});

// Error Handler
app.use((err, req, res, next) => {
  console.error('ERREUR:', err);
  res.status(500).render('500', { error: err.message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
