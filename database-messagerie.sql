-- ========================================
-- BASE DE DONNÉES MESSAGERIE COMPLÈTE
-- ========================================

-- Table des messages
CREATE TABLE IF NOT EXISTS `messages` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `id_expediteur` int(11) NOT NULL,
  `id_destinataire` int(11) NOT NULL,
  `contenu` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `est_lu` tinyint(1) DEFAULT '0',
  `date_envoi` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `type_message` enum('TEXT','CV','DIPLOME') DEFAULT 'TEXT',
  `fichier_path` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `id_expediteur` (`id_expediteur`),
  KEY `id_destinataire` (`id_destinataire`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table des notifications
CREATE TABLE IF NOT EXISTS `notifications` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `id_utilisateur` int(11) NOT NULL,
  `type` enum('MESSAGE','CV','DIPLOME','APPROUVE','REJET') NOT NULL,
  `contenu` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `est_vu` tinyint(1) DEFAULT '0',
  `date_creation` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `id_lien` int(11) DEFAULT NULL, -- ID du message ou document lié
  PRIMARY KEY (`id`),
  KEY `id_utilisateur` (`id_utilisateur`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table des guides (complète)
CREATE TABLE IF NOT EXISTS `guides` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `id_utilisateur` int(11) NOT NULL,
  `cv` varchar(255) DEFAULT NULL,
  `cv_approved` tinyint(1) DEFAULT '0',
  `statut` enum('EN_ATTENTE','ACTIF','BLOQUE') DEFAULT 'EN_ATTENTE',
  `abonnement_actif` tinyint(1) DEFAULT '0',
  `abonnement_fin` date DEFAULT NULL,
  `diplome` varchar(255) DEFAULT NULL,
  `diplome_approved` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `id_utilisateur` (`id_utilisateur`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table des touristes
CREATE TABLE IF NOT EXISTS `touristes` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `id_utilisateur` int(11) NOT NULL,
  `nationalite` varchar(50) DEFAULT NULL,
  `telephone` varchar(20) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `id_utilisateur` (`id_utilisateur`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Données de test pour guides
INSERT INTO `guides` (`id_utilisateur`, `cv`, `cv_approved`, `statut`, `abonnement_actif`) VALUES
(9, 'cvs/ahmed-cv.pdf', 1, 'ACTIF', 1),
(4, 'cvs/guide-sousse-cv.pdf', 1, 'ACTIF', 1),
(8, NULL, 0, 'EN_ATTENTE', 0),
(11, 'cvs/sahar123-cv.pdf', 1, 'ACTIF', 1),
(12, NULL, 0, 'EN_ATTENTE', 0);

-- Données de test pour touristes
INSERT INTO `touristes` (`id_utilisateur`, `nationalite`, `telephone`) VALUES
(2, 'Française', '33612345678'),
(5, 'Tunisienne', '21698765432'),
(7, 'Tunisienne', '21655123456'),
(10, 'Tunisienne', '21622123456'),
(14, 'Tunisienne', '21699887766');

-- Messages de test
INSERT INTO `messages` (`id_expediteur`, `id_destinataire`, `contenu`, `type_message`) VALUES
(9, 13, 'Bonjour, je suis Ahmed guide de Sousse. Je souhaiterais soumettre mon CV pour validation.', 'TEXT'),
(13, 9, 'Bonjour Ahmed, j''ai bien reçu votre demande. Veuillez envoyer votre CV PDF.', 'TEXT'),
(9, 13, 'Voici mon CV, merci de l''examiner.', 'CV'),
(13, 9, 'Votre CV a été approuvé! Vous êtes maintenant guide actif.', 'TEXT'),
(8, 13, 'Bonjour, je suis Sahar guide. Mon CV est en attente de validation.', 'TEXT');

-- Notifications de test
INSERT INTO `notifications` (`id_utilisateur`, `type`, `contenu`, `est_vu`) VALUES
(13, 'MESSAGE', 'Nouveau message de Ahmed', 0),
(9, 'APPROUVE', 'Votre CV a été approuvé', 0),
(13, 'CV', 'Nouveau CV à valider de Sahar', 0),
(8, 'MESSAGE', 'Réponse de l''admin concernant votre CV', 1);
