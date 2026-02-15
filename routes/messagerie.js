// ========================================
// SYSTÈME MESSAGERIE ADMIN ↔ GUIDE
// ========================================

module.exports = (app, db) => {

  // ========================================
  // PAGE MESSAGERIE ADMIN
  // ========================================
  app.get('/admin/messages', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'ADMIN') {
      return res.redirect('/login');
    }

    const adminId = req.session.user.id;

    // Récupérer tous les guides avec messages
    db.query(`
      SELECT DISTINCT u.id, u.nom_complet, u.email,
             (SELECT COUNT(*) FROM messages m 
              WHERE m.id_destinataire = ? AND m.id_expediteur = u.id AND m.est_lu = 0) as unread,
             (SELECT m.contenu FROM messages m 
              WHERE (m.id_expediteur = ? AND m.id_destinataire = u.id) 
                 OR (m.id_expediteur = u.id AND m.id_destinataire = ?)
              ORDER BY m.date_envoi DESC LIMIT 1) as last_message,
             (SELECT m.date_envoi FROM messages m 
              WHERE (m.id_expediteur = ? AND m.id_destinataire = u.id) 
                 OR (m.id_expediteur = u.id AND m.id_destinataire = ?)
              ORDER BY m.date_envoi DESC LIMIT 1) as last_date
      FROM utilisateurs u 
      WHERE u.role = 'GUIDE'
      ORDER BY last_date DESC, u.nom_complet
    `, [adminId, adminId, adminId, adminId, adminId], (err, guides) => {
      
      // Compter messages non lus
      db.query(`
        SELECT COUNT(*) as total_unread 
        FROM messages 
        WHERE id_destinataire = ? AND est_lu = 0
      `, [adminId], (err2, unreadCount) => {
        
        res.render('admin/messages', {
          user: req.session.user,
          guides: guides || [],
          totalUnread: unreadCount[0]?.total_unread || 0
        });
      });
    });
  });

  // ========================================
  // CONVERSATION ADMIN ↔ GUIDE
  // ========================================
  app.get('/admin/messages/:guideId', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'ADMIN') {
      return res.redirect('/login');
    }

    const adminId = req.session.user.id;
    const guideId = req.params.guideId;

    // Vérifier que le guide existe
    db.query('SELECT * FROM utilisateurs WHERE id = ? AND role = ?', [guideId, 'GUIDE'], (err, guide) => {
      if (!guide || guide.length === 0) {
        return res.status(404).send('Guide introuvable');
      }

      // Marquer les messages comme lus
      db.query(`
        UPDATE messages 
        SET est_lu = 1 
        WHERE id_expediteur = ? AND id_destinataire = ? AND est_lu = 0
      `, [guideId, adminId]);

      // Récupérer la conversation
      db.query(`
        SELECT m.*, u.nom_complet as expediteur_nom
        FROM messages m
        JOIN utilisateurs u ON m.id_expediteur = u.id
        WHERE (m.id_expediteur = ? AND m.id_destinataire = ?) 
           OR (m.id_expediteur = ? AND m.id_destinataire = ?)
        ORDER BY m.date_envoi ASC
      `, [guideId, adminId, adminId, guideId], (err2, messages) => {
        
        // Récupérer infos guide (CV, diplôme, etc.)
        db.query(`
          SELECT u.*, g.cv, g.cv_approved, g.diplome, g.diplome_approved, g.statut, g.abonnement_actif
          FROM utilisateurs u
          LEFT JOIN guides g ON u.id = g.id_utilisateur
          WHERE u.id = ?
        `, [guideId], (err3, guideInfo) => {
          
          res.render('admin/conversation', {
            user: req.session.user,
            guide: guideInfo[0],
            messages: messages || []
          });
        });
      });
    });
  });

  // ========================================
  // ENVOYER MESSAGE ADMIN → GUIDE
  // ========================================
  app.post('/admin/messages/:guideId', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    const adminId = req.session.user.id;
    const guideId = req.params.guideId;
    const { message } = req.body;

    if (!message || message.trim() === '') {
      return res.status(400).json({ error: 'Message vide' });
    }

    db.query(`
      INSERT INTO messages (id_expediteur, id_destinataire, contenu, type_message)
      VALUES (?, ?, ?, 'TEXT')
    `, [adminId, guideId, message.trim()], (err, result) => {
      
      if (err) {
        return res.status(500).json({ error: 'Erreur envoi message' });
      }

      // Créer notification pour le guide
      db.query(`
        INSERT INTO notifications (id_utilisateur, type, contenu, id_lien)
        VALUES (?, 'MESSAGE', ?, ?)
      `, [guideId, `Nouveau message de l'admin`, result.insertId]);

      res.json({ 
        success: true, 
        message: 'Message envoyé',
        messageId: result.insertId
      });
    });
  });

  // ========================================
  // PAGE MESSAGERIE GUIDE
  // ========================================
  app.get('/guide/messages', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'GUIDE') {
      return res.redirect('/login');
    }

    const guideId = req.session.user.id;

    // Récupérer la conversation avec l'admin
    db.query(`
      SELECT m.*, u.nom_complet as expediteur_nom
      FROM messages m
      JOIN utilisateurs u ON m.id_expediteur = u.id
      WHERE (m.id_expediteur = ? AND m.id_destinataire = 13) 
         OR (m.id_expediteur = 13 AND m.id_destinataire = ?)
      ORDER BY m.date_envoi ASC
    `, [guideId, guideId], (err, messages) => {
      
      // Marquer les messages comme lus
      db.query(`
        UPDATE messages 
        SET est_lu = 1 
        WHERE id_expediteur = 13 AND id_destinataire = ? AND est_lu = 0
      `, [guideId]);

      // Récupérer infos du guide
      db.query(`
        SELECT u.*, g.cv, g.cv_approved, g.diplome, g.diplome_approved, g.statut
        FROM utilisateurs u
        LEFT JOIN guides g ON u.id = g.id_utilisateur
        WHERE u.id = ?
      `, [guideId], (err2, guideInfo) => {
        
        res.render('guide/messages', {
          user: req.session.user,
          messages: messages || [],
          guide: guideInfo[0]
        });
      });
    });
  });

  // ========================================
  // ENVOYER MESSAGE GUIDE → ADMIN
  // ========================================
  app.post('/guide/messages', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'GUIDE') {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    const guideId = req.session.user.id;
    const { message } = req.body;

    if (!message || message.trim() === '') {
      return res.status(400).json({ error: 'Message vide' });
    }

    db.query(`
      INSERT INTO messages (id_expediteur, id_destinataire, contenu, type_message)
      VALUES (?, 13, ?, 'TEXT')
    `, [guideId, message.trim()], (err, result) => {
      
      if (err) {
        return res.status(500).json({ error: 'Erreur envoi message' });
      }

      // Créer notification pour l'admin
      db.query(`
        INSERT INTO notifications (id_utilisateur, type, contenu, id_lien)
        VALUES (13, 'MESSAGE', ?, ?)
      `, [`Nouveau message de ${req.session.user.nom_complet}`, result.insertId]);

      res.json({ 
        success: true, 
        message: 'Message envoyé',
        messageId: result.insertId
      });
    });
  });

  // ========================================
  // ENVOYER CV GUIDE → ADMIN
  // ========================================
  app.post('/guide/envoyer-cv', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'GUIDE') {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    const guideId = req.session.user.id;

    db.query(`
      INSERT INTO messages (id_expediteur, id_destinataire, contenu, type_message)
      VALUES (?, 13, ?, 'CV')
    `, [guideId, 'Veuillez trouver mon CV ci-joint pour validation.'], (err, result) => {
      
      if (err) {
        return res.status(500).json({ error: 'Erreur envoi CV' });
      }

      // Créer notification pour l'admin
      db.query(`
        INSERT INTO notifications (id_utilisateur, type, contenu, id_lien)
        VALUES (13, 'CV', ?, ?)
      `, [`Nouveau CV à valider de ${req.session.user.nom_complet}`, result.insertId]);

      res.json({ 
        success: true, 
        message: 'CV envoyé pour validation',
        messageId: result.insertId
      });
    });
  });

  // ========================================
  // APPROUVER/REJETER CV ADMIN
  // ========================================
  app.post('/admin/cv/:guideId/:action', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    const guideId = req.params.guideId;
    const action = req.params.action; // 'approve' ou 'reject'

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Action invalide' });
    }

    const statut = action === 'approve' ? 'ACTIF' : 'BLOQUE';
    const cvApproved = action === 'approve' ? 1 : 0;

    db.query(`
      UPDATE guides 
      SET cv_approved = ?, statut = ?
      WHERE id_utilisateur = ?
    `, [cvApproved, statut, guideId], (err) => {
      
      if (err) {
        return res.status(500).json({ error: 'Erreur mise à jour CV' });
      }

      // Envoyer message au guide
      const message = action === 'approve' 
        ? 'Votre CV a été approuvé! Vous êtes maintenant guide actif.'
        : 'Votre CV a été rejeté. Veuillez le corriger et le renvoyer.';

      db.query(`
        INSERT INTO messages (id_expediteur, id_destinataire, contenu, type_message)
        VALUES (13, ?, ?, 'TEXT')
      `, [guideId, message]);

      // Créer notification
      db.query(`
        INSERT INTO notifications (id_utilisateur, type, contenu)
        VALUES (?, ?, ?)
      `, [guideId, action === 'approve' ? 'APPROUVE' : 'REJET', message]);

      res.json({ 
        success: true, 
        message: `CV ${action === 'approve' ? 'approuvé' : 'rejeté'} avec succès`
      });
    });
  });

};
