module.exports = (app, db) => {
  const isAdmin = (req, res, next) => {
    if (!req.session.user || req.session.user.role !== 'ADMIN') {
      return res.redirect('/admin/login');
    }
    next();
  };

  // ========================================
  // DASHBOARD ADMIN
  // ========================================

  // Page dashboard admin
  app.get('/admin/dashboard', isAdmin, (req, res) => {
    // Stats
    db.query(`
      SELECT 
        (SELECT COUNT(*) FROM guides g JOIN utilisateurs u ON g.id_utilisateur = u.id WHERE u.role = 'GUIDE' AND g.cv_approved = 1 AND g.statut = 'ACTIF') as guides_actifs,
        (SELECT COUNT(*) FROM guides g JOIN utilisateurs u ON g.id_utilisateur = u.id WHERE u.role = 'GUIDE' AND g.cv_approved = 0 AND g.cv IS NOT NULL) as guides_en_attente,
        (SELECT COUNT(*) FROM notifications WHERE id_utilisateur = ? AND est_lue = 0) as notifications_non_lues,
        (SELECT COUNT(*) FROM plans_touristiques) as total_plans
    `, [req.session.user.id], (err, stats) => {
      
      // Récupérer les guides en attente de CV
      db.query(`
        SELECT u.id, u.nom_complet, u.email, u.date_creation,
               LEFT(u.nom_complet, 1) as avatar_letter,
               g.cv, g.cv_approved, g.statut
        FROM utilisateurs u 
        LEFT JOIN guides g ON u.id = g.id_utilisateur
        WHERE u.role = 'GUIDE' AND (g.cv_approved = 0 OR g.cv_approved IS NULL) AND g.cv IS NOT NULL AND g.cv != ''
        ORDER BY u.date_creation DESC
      `, (err2, guides_attente) => {
        
        // Récupérer les guides actifs
        db.query(`
          SELECT u.id, u.nom_complet, u.email, u.date_creation,
                 LEFT(u.nom_complet, 1) as avatar_letter,
                 g.cv, g.cv_approved, g.statut, g.abonnement_actif,
                 (SELECT COUNT(*) FROM plans_touristiques WHERE id_guide = u.id) as nb_plans
          FROM utilisateurs u 
          LEFT JOIN guides g ON u.id = g.id_utilisateur
          WHERE u.role = 'GUIDE' AND g.cv_approved = 1
          ORDER BY u.date_creation DESC
        `, (err3, guides_actifs) => {
          
          // Récupérer les notifications récentes
          db.query(`
            SELECT * FROM notifications 
            WHERE id_utilisateur = ?
            ORDER BY date_creation DESC 
            LIMIT 10
          `, [req.session.user.id], (err4, notifications) => {
            
            res.render('admin/dashboard', {
              user: req.session.user,
              stats: stats[0] || { guides_actifs: 0, guides_en_attente: 0, notifications_non_lues: 0, total_plans: 0 },
              guides_attente: guides_attente || [],
              guides_actifs: guides_actifs || [],
              notifications: notifications || []
            });
          });
        });
      });
    });
  });

  // ========================================
  // VALIDATION GUIDES
  // ========================================

  // Page validation guides
  app.get('/admin/validation-guides', isAdmin, (req, res) => {
    const statusFilter = req.query.status || '';
    const cvFilter = req.query.cv || '';

    let whereClause = 'WHERE u.role = "GUIDE"';
    const params = [];

    if (statusFilter) {
      whereClause += ' AND g.statut = ?';
      params.push(statusFilter);
    }

    if (cvFilter !== '') {
      whereClause += ' AND g.cv_approved = ?';
      params.push(parseInt(cvFilter));
    }

    // Récupérer tous les guides avec leurs infos
    db.query(`
      SELECT u.id, u.nom_complet, u.email, u.date_creation,
             g.cv, g.cv_approved, g.statut, g.abonnement_actif, g.abonnement_fin,
             (SELECT m.contenu FROM messages m 
              WHERE (m.id_expediteur = u.id AND m.id_destinataire = ?) 
                 OR (m.id_expediteur = ? AND m.id_destinataire = u.id)
              ORDER BY m.date_creation DESC LIMIT 1) as last_message,
             (SELECT m.date_creation FROM messages m 
              WHERE (m.id_expediteur = u.id AND m.id_destinataire = ?) 
                 OR (m.id_expediteur = ? AND m.id_destinataire = u.id)
              ORDER BY m.date_creation DESC LIMIT 1) as last_date
      FROM utilisateurs u 
      LEFT JOIN guides g ON u.id = g.id_utilisateur
      ${whereClause}
      ORDER BY 
        CASE WHEN g.cv_approved = 0 THEN 1 ELSE 2 END,
        u.date_creation DESC
    `, [req.session.user.id, req.session.user.id, req.session.user.id, req.session.user.id, ...params], (err, guides) => {
      
      // Stats
      db.query(`
        SELECT 
          (SELECT COUNT(*) FROM guides g JOIN utilisateurs u ON g.id_utilisateur = u.id WHERE u.role = 'GUIDE' AND g.cv_approved = 0) as cv_attente,
          (SELECT COUNT(*) FROM guides g JOIN utilisateurs u ON g.id_utilisateur = u.id WHERE u.role = 'GUIDE' AND g.cv_approved = 1 AND g.statut = 'ACTIF') as guides_actifs,
          (SELECT COUNT(*) FROM guides g JOIN utilisateurs u ON g.id_utilisateur = u.id WHERE u.role = 'GUIDE' AND g.abonnement_actif = 1) as abonnements_actifs,
          (SELECT COUNT(*) FROM messages WHERE id_destinataire = ? AND est_lu = 0) as messages_non_lus
      `, [req.session.user.id], (err2, stats) => {
        
        res.render('admin/validation-guides', {
          user: req.session.user,
          guides: guides || [],
          stats: stats[0] || { cv_attente: 0, guides_actifs: 0, abonnements_actifs: 0, messages_non_lus: 0 }
        });
      });
    });
  });

  // Approuver CV
  app.post('/admin/cv/:guideId/approve', isAdmin, (req, res) => {
    const guideId = req.params.guideId;

    db.query(`
      UPDATE guides 
      SET cv_approved = 1, statut = 'ACTIF', date_validation = NOW()
      WHERE id_utilisateur = ?
    `, [guideId], (err) => {
      
      if (err) {
        return res.status(500).json({ error: 'Erreur mise à jour CV' });
      }

      // Envoyer message au guide
      db.query(`
        INSERT INTO messages (id_expediteur, id_destinataire, contenu, type)
        VALUES (?, ?, '✅ Félicitations! Votre CV a été approuvé. Vous pouvez maintenant souscrire à un abonnement.', 'MESSAGE')
      `, [req.session.user.id, guideId]);

      // Notification au guide
      db.query(`
        INSERT INTO notifications (id_utilisateur, titre, contenu, type)
        VALUES (?, '✅ CV Approuvé!', 'Votre CV a été validé. Activez votre abonnement pour commencer.', 'VALIDATION_CV')
      `, [guideId]);

      res.json({ success: true, message: 'CV approuvé avec succès' });
    });
  });

  // Rejeter CV
  app.post('/admin/cv/:guideId/reject', isAdmin, (req, res) => {
    const guideId = req.params.guideId;
    const { raison } = req.body;

    db.query(`
      UPDATE guides 
      SET cv_approved = 0, statut = 'BLOQUE'
      WHERE id_utilisateur = ?
    `, [guideId], (err) => {
      
      if (err) {
        return res.status(500).json({ error: 'Erreur mise à jour CV' });
      }

      // Envoyer message au guide
      const message = raison 
        ? `❌ Votre CV a été rejeté. Raison: ${raison}. Veuillez corriger et renvoyer.`
        : '❌ Votre CV a été rejeté. Veuillez le corriger et le renvoyer.';
      
      db.query(`
        INSERT INTO messages (id_expediteur, id_destinataire, contenu, type)
        VALUES (?, ?, ?, 'MESSAGE')
      `, [req.session.user.id, guideId, message]);

      // Notification au guide
      db.query(`
        INSERT INTO notifications (id_utilisateur, titre, contenu, type)
        VALUES (?, '❌ CV Rejeté', ?, 'VALIDATION_CV')
      `, [guideId, message]);

      res.json({ success: true, message: 'CV rejeté' });
    });
  });

  // Activer abonnement
  app.post('/admin/abonnement/:guideId/activate', isAdmin, (req, res) => {
    const guideId = req.params.guideId;

    // Vérifier que le CV est approuvé
    db.query('SELECT cv_approved FROM guides WHERE id_utilisateur = ?', [guideId], (err, result) => {
      if (err || !result.length || !result[0].cv_approved) {
        return res.status(400).json({ error: 'Le CV doit être approuvé avant d\'activer l\'abonnement' });
      }

      // Créer abonnement 1 mois
      db.query(`
        INSERT INTO abonnements (id_guide, date_debut, date_fin, statut)
        VALUES (?, CURDATE(), DATE_ADD(CURDATE(), INTERVAL 1 MONTH), 'ACTIF')
      `, [guideId]);

      // Mettre à jour statut abonnement guide
      db.query(`
        UPDATE guides 
        SET abonnement_actif = 1, abonnement_fin = DATE_ADD(CURDATE(), INTERVAL 1 MONTH)
        WHERE id_utilisateur = ?
      `, [guideId]);

      // Envoyer message au guide
      db.query(`
        INSERT INTO messages (id_expediteur, id_destinataire, contenu, type)
        VALUES (?, ?, '💳 Votre abonnement mensuel est maintenant actif! Vous pouvez créer des plans touristiques.', 'MESSAGE')
      `, [req.session.user.id, guideId]);

      // Notification au guide
      db.query(`
        INSERT INTO notifications (id_utilisateur, titre, contenu, type)
        VALUES (?, '💳 Abonnement Activé!', 'Votre abonnement mensuel est actif. Commencez à créer des plans!', 'ABONNEMENT')
      `, [guideId]);

      res.json({ success: true, message: 'Abonnement activé avec succès' });
    });
  });

  // ========================================
  // ROUTES EXISTANTES (conservées)
  // ========================================

  // 1. Messagerie - SIMPLE
  app.get('/admin/messages', isAdmin, (req, res) => {
    console.log('=== ADMIN MESSAGES DEBUG ===');
    
    // Vérifier tous les utilisateurs
    db.query('SELECT id, nom_complet, email, role FROM utilisateurs ORDER BY role', (err, allUsers) => {
      if (err) {
        console.log('ERREUR utilisateurs:', err);
        return res.status(500).send('Erreur base de données');
      }
      
      console.log('UTILISATEURS TROUVÉS:', allUsers.length);
      allUsers.forEach(user => {
        console.log(`- ${user.nom_complet} (${user.role})`);
      });
      
      // Vérifier guides spécifiquement
      db.query('SELECT * FROM utilisateurs WHERE role = "GUIDE"', (err, guides) => {
        if (err) {
          console.log('ERREUR guides:', err);
          return res.status(500).send('Erreur guides');
        }
        
        console.log('GUIDES TROUVÉS:', guides.length);
        guides.forEach(guide => {
          console.log(`- GUIDE: ${guide.nom_complet} (ID: ${guide.id})`);
        });
        
        // Récupérer les guides avec infos complètes
        db.query(`
          SELECT u.id, u.nom_complet, u.email, 
                 LEFT(u.nom_complet, 1) as avatar_letter,
                 g.statut, g.cv_approved, g.cv, g.abonnement_actif
          FROM utilisateurs u 
          LEFT JOIN guides g ON u.id = g.id_utilisateur
          WHERE u.role = 'GUIDE'
          ORDER BY u.date_creation DESC
        `, (err, guidesFull) => {
          if (err) {
            console.log('ERREUR guides full:', err);
            return res.status(500).send('Erreur guides full');
          }
          
          console.log('GUIDES FULL:', guidesFull.length);
          
          // Compter messages non lus
          db.query('SELECT COUNT(*) as total_unread FROM messages WHERE id_destinataire = ? AND est_lu = 0', [req.session.user.id], (err2, unreadCount) => {
            
            res.render('admin/messages', { 
              user: req.session.user, 
              guides: guidesFull || [],
              totalUnread: unreadCount[0]?.total_unread || 0,
              debug: {
                allUsers: allUsers || [],
                guidesCount: guidesFull?.length || 0,
                rawGuides: guides || []
              }
            });
          });
        });
      });
    });
  });

  // 2. Conversation
  app.get('/admin/messages/:guideId', isAdmin, (req, res) => {
    const guideId = req.params.guideId;
    
    db.query(`
      SELECT m.*, u.nom_complet as sender_name
      FROM messages m 
      LEFT JOIN utilisateurs u ON m.id_expediteur = u.id
      WHERE m.id_destinataire = ? OR m.id_expediteur = ?
      ORDER BY m.date_creation ASC
    `, [guideId, guideId], (err, messages) => {

      db.query(`
        SELECT u.*, g.* 
        FROM utilisateurs u 
        LEFT JOIN guides g ON u.id = g.id_utilisateur 
        WHERE u.id = ?
      `, [guideId], (err2, guide) => {
        res.render('admin/conversation', {
          user: req.session.user,
          guide: guide[0] || {},
          messages: messages || []
        });
      });
    });
  });

  // 3. Envoyer message
  app.post('/admin/messages/:guideId', isAdmin, (req, res) => {
    const adminId = req.session.user.id;
    const guideId = req.params.guideId;
    const { contenu } = req.body;

    db.query(
      "INSERT INTO messages (id_expediteur, id_destinataire, contenu) VALUES (?, ?, ?)",
      [adminId, guideId, contenu],
      () => res.redirect(`/admin/messages/${guideId}`)
    );
  });

  // 4. Notifications vers tous les guides
  app.post('/admin/notifications/guides', isAdmin, async (req, res) => {
    const { titre, contenu } = req.body;

    try {
      // 1) récupérer ids des guides
      const [guides] = await db.query(
        `SELECT id FROM utilisateurs WHERE role = 'GUIDE' AND est_actif = 1` 
      );

      // 2) insert notification pour kol guide
      const values = guides.map(g => [g.id, titre, contenu, 'MESSAGE']);
      if (values.length) {
        await db.query(
          `INSERT INTO notifications (id_utilisateur, titre, contenu, type)
           VALUES ?`,
          [values]
        );
      }

      res.redirect('/admin/dashboard');
    } catch (error) {
      console.error('Erreur envoi notification:', error);
      res.status(500).send('Erreur lors de l\'envoi des notifications');
    }
  });

  // 5. Validation CV (accepter)
  app.post('/guides/:id/valider-cv', isAdmin, async (req, res) => {
    const idGuide = req.params.id;

    try {
      await db.query(
        `UPDATE guides
         SET cv_approved = 1, date_validation = NOW()
         WHERE id_utilisateur = ?`,
        [idGuide]
      );

      await db.query(
        `INSERT INTO notifications (id_utilisateur, titre, contenu, type)
         VALUES (?, 'CV validé', 'Votre CV a été accepté', 'VALIDATION_CV')`,
        [idGuide]
      );

      res.redirect('/admin/guides');
    } catch (error) {
      console.error('Erreur validation CV:', error);
      res.status(500).send('Erreur lors de la validation du CV');
    }
  });

  // 5.2. Refus CV
  app.post('/guides/:id/refuser-cv', isAdmin, async (req, res) => {
    const idGuide = req.params.id;

    try {
      await db.query(
        `UPDATE guides
         SET cv_approved = 0, statut = 'BLOQUE'
         WHERE id_utilisateur = ?`,
        [idGuide]
      );

      await db.query(
        `INSERT INTO notifications (id_utilisateur, titre, contenu, type)
         VALUES (?, 'CV refusé', 'Votre CV a été refusé. Veuillez le corriger et le renvoyer.', 'VALIDATION_CV')`,
        [idGuide]
      );

      res.redirect('/admin/guides');
    } catch (error) {
      console.error('Erreur refus CV:', error);
      res.status(500).send('Erreur lors du refus du CV');
    }
  });

  // 6. Approuver CV
  app.post('/admin/cv/:id/approve', isAdmin, (req, res) => {
    const guideId = req.params.id;
    db.query(
      "INSERT IGNORE INTO guides (id_utilisateur, cv_approved, cv, statut) VALUES (?,  'cv depose', 'APPROUVE') ON DUPLICATE KEY UPDATE cv_approved=1, cv='cv depose', statut='APPROUVE'",
      [guideId],
      () => res.redirect(`/admin/messages/${guideId}`)
    );
  });
};
