const express = require('express');
const mysql = require('mysql2/promise');
const router = express.Router();

const pool = mysql.createPool({
  host: 'localhost',
  user: 'root', 
  password: '', 
  database: 'tourisme_tn',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// ========================================
// ROUTES ACCUEIL - GOUVERNORATS ET PLANS
// ========================================

// Route Index - Accueil avec gouvernorats
router.get('/', async (req, res) => {
  try {
    const [gouvernorats] = await pool.execute(`
      SELECT g.*, 
             (SELECT COUNT(*) FROM plans_touristiques pt 
              JOIN guides gu ON pt.id_guide = gu.id_utilisateur 
              WHERE gu.id_utilisateur = g.id) as nb_plans
      FROM gouvernorats g 
      ORDER BY g.id
    `);
    
    res.render('accueil', { 
      gouvernorats: gouvernorats || [], 
      user: req.session.user 
    });
  } catch (err) {
    console.error('Erreur accueil:', err);
    res.render('accueil', { 
      gouvernorats: [], 
      user: req.session.user 
    });
  }
});

// Route Plans par gouvernorat
router.get('/plans/:gouvId', async (req, res) => {
  const gouvId = req.params.gouvId;
  
  try {
    // Récupérer gouvernorat
    const [gouvernorat] = await pool.execute(
      'SELECT * FROM gouvernorats WHERE id = ?', [gouvId]
    );
    
    // Récupérer délégations avec nombre de lieux
    const [delegations] = await pool.execute(`
      SELECT d.*, 
             (SELECT COUNT(*) FROM plan_lieux pl WHERE pl.id_delegation = d.id) as nb_lieux
      FROM delegations d 
      WHERE d.id_gouvernorat = ?
      ORDER BY d.nom
    `, [gouvId]);
    
    res.render('plans/gouvernorat', { 
      gouvernorat: gouvernorat[0] || null, 
      delegations: delegations || [], 
      user: req.session.user 
    });
  } catch (err) {
    console.error('Erreur gouvernorat:', err);
    res.status(500).send('Erreur serveur');
  }
});

// Route Délégation - Détails des lieux
router.get('/delegation/:delId', async (req, res) => {
  const delId = req.params.delId;
  
  try {
    // Récupérer délégation avec gouvernorat
    const [delegation] = await pool.execute(`
      SELECT d.*, g.nom as gouvernorat_nom, g.id as gouvernorat_id
      FROM delegations d
      JOIN gouvernorats g ON d.id_gouvernorat = g.id
      WHERE d.id = ?
    `, [delId]);
    
    // Récupérer lieux de la délégation
    const [lieux] = await pool.execute(`
      SELECT pl.*, pt.titre as plan_titre, pt.description as plan_description, 
             u.nom_complet as guide_nom, pt.prix
      FROM plan_lieux pl
      LEFT JOIN plans_touristiques pt ON pl.id_plan = pt.id
      LEFT JOIN utilisateurs u ON pt.id_guide = u.id
      WHERE pl.id_delegation = ?
      ORDER BY pl.type, pl.id
    `, [delId]);
    
    // Regrouper par type
    const lieuxGroupes = {
      HOTEL: lieux.filter(l => l.type === 'HOTEL'),
      RESTAURANT: lieux.filter(l => l.type === 'RESTAURANT'),
      MUSEE: lieux.filter(l => l.type === 'MUSEE'),
      AUTRE: lieux.filter(l => l.type === 'AUTRE')
    };
    
    res.render('plans/delegation', { 
      delegation: delegation[0] || null, 
      lieux: lieuxGroupes,
      user: req.session.user 
    });
  } catch (err) {
    console.error('Erreur délégation:', err);
    res.status(500).send('Erreur serveur');
  }
});

// Route Plans détaillés
router.get('/plan/:planId', async (req, res) => {
  const planId = req.params.planId;
  
  try {
    // Récupérer plan avec guide
    const [plan] = await pool.execute(`
      SELECT pt.*, u.nom_complet as guide_nom, u.email as guide_email,
             g.cv_approved, g.abonnement_actif
      FROM plans_touristiques pt
      JOIN utilisateurs u ON pt.id_guide = u.id
      LEFT JOIN guides g ON u.id = g.id_utilisateur
      WHERE pt.id = ?
    `, [planId]);
    
    // Récupérer lieux du plan
    const [lieux] = await pool.execute(`
      SELECT pl.*, d.nom as delegation_nom, g.nom as gouvernorat_nom
      FROM plan_lieux pl
      JOIN delegations d ON pl.id_delegation = d.id
      JOIN gouvernorats g ON d.id_gouvernorat = g.id
      WHERE pl.id_plan = ?
      ORDER BY pl.type
    `, [planId]);
    
    // Récupérer avis du plan
    const [avis] = await pool.execute(`
      SELECT a.*, u.nom_complet as touriste_nom
      FROM avis a
      JOIN utilisateurs u ON a.id_touriste = u.id
      WHERE a.id_guide = ?
      ORDER BY a.date_creation DESC
    `, [plan[0]?.id_guide]);
    
    res.render('plans/plan', { 
      plan: plan[0] || null, 
      lieux: lieux || [],
      avis: avis || [],
      user: req.session.user 
    });
  } catch (err) {
    console.error('Erreur plan:', err);
    res.status(500).send('Erreur serveur');
  }
});

// API pour rechercher des plans
router.get('/api/search', async (req, res) => {
  const { q, type, gouvernorat } = req.query;
  
  try {
    let sql = `
      SELECT pt.*, u.nom_complet as guide_nom, g.nom as gouvernorat_nom,
             d.nom as delegation_nom
      FROM plans_touristiques pt
      JOIN utilisateurs u ON pt.id_guide = u.id
      LEFT JOIN guides gu ON u.id = gu.id_utilisateur
      LEFT JOIN plan_lieux pl ON pt.id = pl.id_plan
      LEFT JOIN delegations d ON pl.id_delegation = d.id
      LEFT JOIN gouvernorats g ON d.id_gouvernorat = g.id
      WHERE gu.cv_approved = 1 AND gu.abonnement_actif = 1
    `;
    
    const params = [];
    
    if (q) {
      sql += ` AND (pt.titre LIKE ? OR pt.description LIKE ?)`;
      params.push(`%${q}%`, `%${q}%`);
    }
    
    if (type) {
      sql += ` AND pl.type = ?`;
      params.push(type);
    }
    
    if (gouvernorat) {
      sql += ` AND g.id = ?`;
      params.push(gouvernorat);
    }
    
    sql += ` GROUP BY pt.id ORDER BY pt.date_creation DESC`;
    
    const [plans] = await pool.execute(sql, params);
    res.json(plans);
  } catch (err) {
    console.error('Erreur recherche:', err);
    res.status(500).json({ error: 'Erreur recherche' });
  }
});

module.exports = (app, db) => {
  // Utiliser les routes du router
  app.use('/', router);
};