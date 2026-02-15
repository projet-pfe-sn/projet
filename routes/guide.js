module.exports = (app, db) => {
  const isGuide = (req, res, next) => {
    if (!req.session.user || req.session.user.role !== 'GUIDE') {
      return res.redirect('/login');
    }
    next();
  };

  // Middleware auth guide pour API
  const requireGuide = (req, res, next) => {
    if (req.session.user?.role === 'GUIDE') return next();
    res.status(403).json({ error: 'Accès refusé' });
  };

  // ========================================
  // ROUTES API MODERNES
  // ========================================

  // Messages API
  app.get('/api/guide/messages/:adminId', requireGuide, async (req, res) => {
    const { adminId } = req.params;
    const guideId = req.session.user.id;
    
    db.query(`
      SELECT m.*, u.nom_complet as expediteur_nom
      FROM messages m 
      JOIN utilisateurs u ON m.id_expediteur = u.id
      WHERE (m.id_expediteur = ? AND m.id_destinataire = ?) 
         OR (m.id_expediteur = ? AND m.id_destinataire = ?)
      ORDER BY m.date_envoi ASC
    `, [guideId, adminId, adminId, guideId], (err, messages) => {
      if (err) return res.status(500).json({ error: 'Erreur serveur' });
      res.json(messages || []);
    });
  });

  // Envoyer message API
  app.post('/api/guide/send-message', requireGuide, (req, res) => {
    const { destinataire, contenu } = req.body;
    const expediteur = req.session.user.id;
    
    if (!contenu || !destinataire) {
      return res.status(400).json({ error: 'Contenu et destinataire requis' });
    }
    
    db.query(
      'INSERT INTO messages (id_expediteur, id_destinataire, contenu, type_message) VALUES (?, ?, ?, "TEXT")',
      [expediteur, destinataire, contenu],
      (err, result) => {
        if (err) return res.status(500).json({ error: 'Erreur envoi message' });
        
        // Notification admin
        db.query(
          'INSERT INTO notifications (id_utilisateur, type, contenu, id_lien) VALUES (?, "MESSAGE", ?, ?)',
          [destinataire, `Nouveau message de ${req.session.user.nom_complet}`, result.insertId]
        );
        
        res.json({ success: true, messageId: result.insertId });
      }
    );
  });

  // Envoyer CV/Diplôme API
  const multer = require('multer');
  const upload = multer({ 
    dest: 'public/uploads/cv/',
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
      if (file.mimetype === 'application/pdf' || file.mimetype.includes('document')) {
        cb(null, true);
      } else {
        cb(new Error('Seuls les PDF et documents sont acceptés'), false);
      }
    }
  });

  app.post('/api/guide/envoyer-cv', requireGuide, upload.single('fichier'), (req, res) => {
    const { type, destinataire } = req.body;
    const expediteur = req.session.user.id;
    const fichier = req.file ? req.file.filename : null;
    
    if (!type || !destinataire) {
      return res.status(400).json({ error: 'Type et destinataire requis' });
    }
    
    db.query(
      'INSERT INTO messages (id_expediteur, id_destinataire, contenu, type_message, fichier_path) VALUES (?, ?, ?, ?, ?)',
      [expediteur, destinataire, `Document ${type} envoyé`, type, fichier],
      (err, result) => {
        if (err) return res.status(500).json({ error: 'Erreur envoi document' });
        
        // Notification admin
        db.query(
          'INSERT INTO notifications (id_utilisateur, type, contenu, id_lien) VALUES (?, ?, ?, ?)',
          [destinataire, type, `${req.session.user.nom_complet} a envoyé un ${type}`, result.insertId]
        );
        
        res.json({ success: true, messageId: result.insertId });
      }
    );
  });

  // Dashboard API
  app.get('/api/guide/dashboard', requireGuide, (req, res) => {
    const guideId = req.session.user.id;
    
    // Récupérer infos guide
    db.query(`
      SELECT u.*, g.cv, g.statut, g.cv_approved, g.abonnement_actif, g.abonnement_fin
      FROM utilisateurs u 
      LEFT JOIN guides g ON u.id = g.id_utilisateur 
      WHERE u.id = ?
    `, [guideId], (err, guideInfo) => {
      if (err || !guideInfo.length) return res.status(500).json({ error: 'Guide introuvable' });
      
      const guide = guideInfo[0];
      
      // Récupérer notifications
      db.query(
        'SELECT * FROM notifications WHERE id_utilisateur = ? ORDER BY date_creation DESC LIMIT 10',
        [guideId],
        (err2, notifications) => {
          // Récupérer stats
          db.query(`
            SELECT 
              (SELECT COUNT(*) FROM plans_touristiques WHERE id_guide = ?) as nb_plans,
              (SELECT COUNT(*) FROM messages WHERE id_destinataire = ? AND est_lu = 0) as messages_non_lus,
              (SELECT COUNT(*) FROM notifications WHERE id_utilisateur = ? AND est_vu = 0) as notifications_non_lues
          `, [guideId, guideId, guideId], (err3, stats) => {
            
            res.json({
              user: req.session.user,
              guide: guide,
              notifications: notifications || [],
              stats: stats[0] || { nb_plans: 0, messages_non_lus: 0, notifications_non_lues: 0 },
              adminId: 13
            });
          });
        }
      );
    });
  });

  // ========================================
  // UPLOAD CV/DIPLOME
  // ========================================

  // Page upload CV
  app.get('/guide/cv/upload', isGuide, (req, res) => {
    const guideId = req.session.user.id;
    
    // Récupérer infos guide
    db.query(`
      SELECT u.*, g.cv, g.diplome, g.cv_approved, g.diplome_approved, g.statut
      FROM utilisateurs u 
      LEFT JOIN guides g ON u.id = g.id_utilisateur 
      WHERE u.id = ?
    `, [guideId], (err, guideInfo) => {
      const guide = guideInfo && guideInfo.length > 0 ? guideInfo[0] : {};
      
      res.render('guide/upload-cv', {
        user: req.session.user,
        guide: guide
      });
    });
  });

  // Envoyer CV à l'admin
  const uploadCV = multer({ 
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        cb(null, 'public/uploads/cv/');
      },
      filename: (req, file, cb) => {
        const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + '-' + file.originalname;
        cb(null, uniqueName);
      }
    }),
    fileFilter: (req, file, cb) => {
      const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
      if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('Seuls les fichiers PDF, DOC et DOCX sont acceptés'), false);
      }
    },
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB
  });

  app.post('/guide/envoyer-cv', uploadCV.single('cv'), (req, res) => {
    if (!req.session.user || req.session.user.role !== "GUIDE") {
      return res.status(403).json({ error: "Accès refusé" });
    }

    const idGuide = req.session.user.id;
    const idAdmin = 13; // Admin principal

    const fichierPath = req.file ? req.file.path.replace('public/', '') : null;

    // 1) Mettre à jour le CV dans la table guides
    db.query(`
      UPDATE guides 
      SET cv = ?, cv_approved = 0, date_soumission = NOW()
      WHERE id_utilisateur = ?
    `, [fichierPath, idGuide], (err, updateResult) => {
      
      // 2) Message vers admin
      db.query(`
        INSERT INTO messages (id_expediteur, id_destinataire, contenu, type, fichier, date_creation)
        VALUES (?, ?, ?, 'CV', ?, NOW())
      `, [idGuide, idAdmin, 'CV soumis pour validation', fichierPath], (err, msgResult) => {
        
        // 3) Notification pour admin
        db.query(`
          INSERT INTO notifications (id_utilisateur, type, contenu, date_creation)
          VALUES (?, 'VALIDATION_CV', ?, NOW())
        `, [idAdmin, `CV soumis par ${req.session.user.nom_complet}`], (err, notifResult) => {
          
          res.json({ 
            success: true, 
            message: 'CV envoyé pour validation avec succès'
          });
        });
      });
    });
  });

  // Envoyer Diplôme à l'admin
  const uploadDiplome = multer({ 
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        cb(null, 'public/uploads/diplomes/');
      },
      filename: (req, file, cb) => {
        const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + '-' + file.originalname;
        cb(null, uniqueName);
      }
    }),
    fileFilter: (req, file, cb) => {
      const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
      if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('Seuls les fichiers PDF, DOC et DOCX sont acceptés'), false);
      }
    },
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB
  });

  app.post('/guide/envoyer-diplome', uploadDiplome.single('diplome'), (req, res) => {
    if (!req.session.user || req.session.user.role !== "GUIDE") {
      return res.status(403).json({ error: "Accès refusé" });
    }

    const idGuide = req.session.user.id;
    const idAdmin = 13; // Admin principal

    const fichierPath = req.file ? req.file.path.replace('public/', '') : null;

    // 1) Mettre à jour le diplôme dans la table guides
    db.query(`
      UPDATE guides 
      SET diplome = ?, diplome_approved = 0, date_soumission_diplome = NOW()
      WHERE id_utilisateur = ?
    `, [fichierPath, idGuide], (err, updateResult) => {
      
      // 2) Message vers admin
      db.query(`
        INSERT INTO messages (id_expediteur, id_destinataire, contenu, type, fichier, date_creation)
        VALUES (?, ?, ?, 'DIPLOME', ?, NOW())
      `, [idGuide, idAdmin, 'Diplôme soumis pour validation', fichierPath], (err, msgResult) => {
        
        // 3) Notification pour admin
        db.query(`
          INSERT INTO notifications (id_utilisateur, type, contenu, date_creation)
          VALUES (?, 'VALIDATION_DIPLOME', ?, NOW())
        `, [idAdmin, `Diplôme soumis par ${req.session.user.nom_complet}`], (err, notifResult) => {
          
          res.json({ 
            success: true, 
            message: 'Diplôme envoyé pour validation avec succès'
          });
        });
      });
    });
  });

  // Upload CV (POST)
  app.post('/guide/cv/upload', isGuide, (req, res) => {
    const upload = require('multer')({
      storage: require('multer').diskStorage({
        destination: (req, file, cb) => {
          cb(null, 'public/uploads/cv/');
        },
        filename: (req, file, cb) => {
          const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + '-' + file.originalname;
          cb(null, uniqueName);
        }
      }),
      fileFilter: (req, file, cb) => {
        // Accepter PDF, DOC, DOCX
        const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
        if (allowedTypes.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new Error('Seuls les fichiers PDF, DOC et DOCX sont acceptés'), false);
        }
      },
      limits: { fileSize: 5 * 1024 * 1024 } // 5MB
    });

    upload.single('cv_file')(req, res, (err) => {
      if (err) {
        console.error('Erreur upload:', err);
        return res.render('guide/upload-cv', {
          user: req.session.user,
          error: 'Erreur upload: ' + err.message
        });
      }

      if (!req.file) {
        return res.render('guide/upload-cv', {
          user: req.session.user,
          error: 'Veuillez sélectionner un fichier'
        });
      }

      const guideId = req.session.user.id;
      const cvPath = 'uploads/cv/' + req.file.filename;

      // Vérifier si guide existe dans table guides
      db.query('SELECT * FROM guides WHERE id_utilisateur = ?', [guideId], (err, guideRow) => {
        if (err) {
          console.error('Erreur vérification guide:', err);
          return res.render('guide/upload-cv', {
            user: req.session.user,
            error: 'Erreur serveur'
          });
        }

        if (guideRow.length === 0) {
          // Créer entrée guide
          db.query(
            'INSERT INTO guides (id_utilisateur, cv, cv_approved, statut) VALUES (?, ?, 0, "EN_ATTENTE")',
            [guideId, cvPath],
            (err) => {
              if (err) {
                console.error('Erreur création guide:', err);
                return res.render('guide/upload-cv', {
                  user: req.session.user,
                  error: 'Erreur création guide'
                });
              }

              // Envoyer message à l'admin
              // Récupérer l'ID de l'admin
              db.query('SELECT id FROM utilisateurs WHERE role = "ADMIN" LIMIT 1', (adminErr, adminResult) => {
                const adminId = adminResult[0]?.id || 13; // fallback à 13 si pas d'admin
                
                db.query(
                  'INSERT INTO messages (id_expediteur, id_destinataire, contenu, type) VALUES (?, ?, ?, "CV")',
                  [guideId, adminId, `Nouveau CV soumis par ${req.session.user.nom_complet}`],
                  (msgErr) => {
                    if (msgErr) console.error('Erreur message admin:', msgErr);
                  }
                );

                // Notification admin
                db.query(
                  'INSERT INTO notifications (id_utilisateur, type, contenu) VALUES (?, "CV", ?)',
                  [adminId, `Nouveau CV à valider de ${req.session.user.nom_complet}`],
                  (notifErr) => {
                    if (notifErr) console.error('Erreur notification:', notifErr);
                  }
                );
              });

              res.render('guide/upload-cv', {
                user: req.session.user,
                success: 'CV envoyé avec succès! En attente de validation admin.'
              });
            }
          );
        } else {
          // Mettre à jour CV existant
          db.query(
            'UPDATE guides SET cv = ?, cv_approved = 0, statut = "EN_ATTENTE" WHERE id_utilisateur = ?',
            [cvPath, guideId],
            (err) => {
              if (err) {
                console.error('Erreur mise à jour CV:', err);
                return res.render('guide/upload-cv', {
                  user: req.session.user,
                  error: 'Erreur mise à jour CV'
                });
              }

              // Envoyer message à l'admin
              // Récupérer l'ID de l'admin
              db.query('SELECT id FROM utilisateurs WHERE role = "ADMIN" LIMIT 1', (adminErr, adminResult) => {
                const adminId = adminResult[0]?.id || 13; // fallback à 13 si pas d'admin
                
                db.query(
                  'INSERT INTO messages (id_expediteur, id_destinataire, contenu, type) VALUES (?, ?, ?, "CV")',
                  [guideId, adminId, `CV mis à jour par ${req.session.user.nom_complet}`],
                  (msgErr) => {
                    if (msgErr) console.error('Erreur message admin:', msgErr);
                  }
                );

                // Notification admin
                db.query(
                  'INSERT INTO notifications (id_utilisateur, type, contenu) VALUES (?, "CV", ?)',
                  [adminId, `CV mis à jour par ${req.session.user.nom_complet} - À valider`],
                  (notifErr) => {
                    if (notifErr) console.error('Erreur notification:', notifErr);
                  }
                );
              });

              res.render('guide/upload-cv', {
                user: req.session.user,
                success: 'CV mis à jour! En attente de validation admin.'
              });
            }
          );
        }
      });
    });
  });

  // Upload Diplôme (POST)
  app.post('/guide/diplome/upload', isGuide, (req, res) => {
    const upload = require('multer')({
      storage: require('multer').diskStorage({
        destination: (req, file, cb) => {
          cb(null, 'public/uploads/diplomes/');
        },
        filename: (req, file, cb) => {
          const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + '-' + file.originalname;
          cb(null, uniqueName);
        }
      }),
      fileFilter: (req, file, cb) => {
        const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
        if (allowedTypes.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new Error('Seuls les fichiers PDF, DOC et DOCX sont acceptés'), false);
        }
      },
      limits: { fileSize: 5 * 1024 * 1024 }
    });

    upload.single('diplome_file')(req, res, (err) => {
      if (err) {
        console.error('Erreur upload diplôme:', err);
        return res.redirect('/guide/profile?error=' + encodeURIComponent(err.message));
      }

      if (!req.file) {
        return res.redirect('/guide/profile?error=Veuillez sélectionner un fichier');
      }

      const guideId = req.session.user.id;
      const diplomePath = 'uploads/diplomes/' + req.file.filename;

      // Créer dossier diplomes si n'existe pas
      const fs = require('fs');
      if (!fs.existsSync('public/uploads/diplomes')) {
        fs.mkdirSync('public/uploads/diplomes', { recursive: true });
      }

      // Mettre à jour diplôme
      db.query(
        'UPDATE guides SET diplome = ?, diplome_approved = 0 WHERE id_utilisateur = ?',
        [diplomePath, guideId],
        (err) => {
          if (err) {
            console.error('Erreur mise à jour diplôme:', err);
            return res.redirect('/guide/profile?error=Erreur mise à jour diplôme');
          }

          // Envoyer message à l'admin
          // Récupérer l'ID de l'admin
          db.query('SELECT id FROM utilisateurs WHERE role = "ADMIN" LIMIT 1', (adminErr, adminResult) => {
            const adminId = adminResult[0]?.id || 13; // fallback à 13 si pas d'admin
            
            db.query(
              'INSERT INTO messages (id_expediteur, id_destinataire, contenu, type) VALUES (?, ?, ?, "DIPLOME")',
              [guideId, adminId, `Nouveau diplôme soumis par ${req.session.user.nom_complet}`],
              (msgErr) => {
                if (msgErr) console.error('Erreur message admin:', msgErr);
              }
            );

            // Notification admin
            db.query(
              'INSERT INTO notifications (id_utilisateur, type, contenu) VALUES (?, "DIPLOME", ?)',
              [adminId, `Nouveau diplôme à valider de ${req.session.user.nom_complet}`],
              (notifErr) => {
                if (notifErr) console.error('Erreur notification:', notifErr);
              }
            );
          });

          res.redirect('/guide/profile?success=Diplôme envoyé avec succès! En attente de validation.');
        }
      );
    });
  });

  // ========================================
  // ROUTES EXISTANTES (conservées)
  // ========================================

  // Paiement abonnement (1 mois)
  app.post('/guide/abonnement/payer', isGuide, (req, res) => {
    const guideId = req.session.user.id;

    // Vérifier CV approuvé
    db.query("SELECT cv_approved FROM guides WHERE id_utilisateur = ?", [guideId], (err, rows) => {
      if (!rows[0].cv_approved) {
        return res.render('guide/dashboard', { 
          user: req.session.user,
          error: 'CV non approuvé' 
        });
      }

      // Créer abonnement 1 MOIS
      db.query(
        "INSERT INTO abonnements (id_guide, date_debut, date_fin, statut) VALUES (?, CURDATE(), DATE_ADD(CURDATE(), INTERVAL 1 MONTH), 'ACTIF')",
        [guideId]
      );

      db.query("UPDATE guides SET abonnement_actif = 1 WHERE id_utilisateur = ?", [guideId]);

      // Notification succès
      db.query("INSERT INTO notifications (id_utilisateur, type, contenu) VALUES (?, 'ABONNEMENT', '✅ Abonnement 1 mois activé ! Créez vos plans')", [guideId]);

      res.redirect('/guide/dashboard');
    });
  });

  // Dashboard Guide
  app.get('/guide/dashboard', isGuide, (req, res) => {
    const id_guide = req.session.user.id;

    // Récupérer infos guide
      db.query(`
        SELECT u.*, g.cv, g.statut, g.cv_approved, g.abonnement_actif
        FROM utilisateurs u 
        LEFT JOIN guides g ON u.id = g.id_utilisateur 
        WHERE u.id = ?
      `, [id_guide], (err, guideInfo) => {
        const guide = guideInfo && guideInfo.length > 0 ? guideInfo[0] : {};
        
        res.render("guide/dashboard", {
          user: req.session.user,
          cv_approved: guide.cv_approved || false,
          abonnement_actif: guide.abonnement_actif || false,
          statut: guide.statut || 'EN_ATTENTE'
        });
      });
  });

  // Messages Guide
  app.get('/guide/messages', isGuide, (req, res) => {
    const guideId = req.session.user.id;
    const adminId = 13; // Admin ID

    db.query(`
      SELECT m.*, u.nom_complet as admin_name
      FROM messages m 
      JOIN utilisateurs u ON m.id_expediteur = u.id
      WHERE (m.id_expediteur = ? AND m.id_destinataire = ?) OR (m.id_expediteur = ? AND m.id_destinataire = ?)
      ORDER BY m.date_creation DESC
    `, [guideId, adminId, adminId, guideId], (err, messages) => {
      res.render("guide/messages", {
        user: req.session.user,
        messages
      });
    });
  });

  // Envoyer message à l'admin
  app.post('/guide/messages', isGuide, (req, res) => {
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

  // Marquer notifications comme lues
  app.post('/guide/notifications/read', isGuide, (req, res) => {
    const guideId = req.session.user.id;
    
    db.query(
      "UPDATE notifications SET est_vu = 1 WHERE id_utilisateur = ? AND est_vu = 0",
      [guideId],
      (err) => {
        if (err) return res.status(500).json({ error: "Erreur serveur" });
        res.json({ success: true });
      }
    );
  });

  // Refresh notifications count
  app.get('/guide/notifications/refresh', isGuide, (req, res) => {
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
};
