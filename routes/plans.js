module.exports = (app, db) => {
  app.get('/plans/:id', (req, res) => {
    const gouvernoratId = parseInt(req.params.id);
    
    db.query('SELECT * FROM gouvernorats WHERE id = ?', [gouvernoratId], (err, gouvernorat) => {
      if (!gouvernorat[0]) return res.status(404).send('Gouvernorat introuvable');
      
      // TOUS LES LIEUX du gouvernorat
      db.query(`
        SELECT * FROM lieux_touristiques 
        WHERE gouvernorat_id = ?
        ORDER BY nom
      `, [gouvernoratId], (err2, lieux) => {
        
        // Guides disponibles
        db.query(`
          SELECT u.id, u.nom_complet, u.email, g.statut, g.abonnement_actif
          FROM utilisateurs u 
          JOIN guides g ON u.id = g.id_utilisateur
          WHERE u.role = 'GUIDE' AND g.abonnement_actif = 1
        `, (err3, guides) => {
          
          res.render('plans/gouvernorat', {
            gouvernorat: gouvernorat[0],
            lieux: lieux || [],
            guides: guides || [],
            user: req.session.user || null
          });
        });
      });
    });
  });
};
