import type { LegalContent } from "./types";

const fr: LegalContent = {
  updated: "Dernière mise à jour : {updated}",
  contents: "Sur cette page",
  docs: {
    about: {
      title: "À propos d'EndzoneIQ et du fonctionnement du modèle",
      description:
        "Ce qu'est EndzoneIQ, d'où viennent ses données, et comment chaque pronostic est établi, publié et évalué.",
      sections: [
        {
          heading: "Ce qu'est EndzoneIQ",
          body: [
            "EndzoneIQ aide les fans de NFL à comprendre chaque match en une soixantaine de secondes : un pronostic, une probabilité de victoire, un niveau de confiance et trois raisons claires. C'est de l'analyse pour les fans, **pas un service de paris**, et EndzoneIQ n'est affilié ni à la NFL ni à aucune équipe.",
            "Chaque pronostic publié reste visible dans le [bilan](/record), réussi ou raté.",
          ],
        },
        {
          heading: "Le modèle, simplement",
          body: [
            "Le point de départ est une note Elo pour chaque équipe : un nombre qui monte quand l'équipe gagne et descend quand elle perd, d'autant plus que le résultat était inattendu. À lui seul, l'Elo donne déjà des pronostics raisonnables.",
            "Par-dessus l'Elo, un modèle d'apprentissage automatique (LightGBM) apprend de petites corrections à partir de ce que l'Elo ne voit pas :",
            [
              "l'efficacité de chaque attaque et de chaque défense, action par action (EPA et taux de réussite), y compris la passe, la course, les grosses actions et les pertes de balle ;",
              "un changement de quarterback, et les titulaires blessés déclarés forfait ou incertains ;",
              "les jours de repos, les semaines courtes, les semaines de repos, la distance parcourue et les fuseaux horaires traversés ;",
              "les terrains neutres, les matchs de division et les playoffs ;",
              "la météo des matchs en plein air : vent et température.",
            ],
            "Le modèle n'utilise jamais les cotes des bookmakers : il reste indépendant du marché. Ses probabilités sont calibrées : quand il annonce 70 %, l'équipe choisie devrait gagner environ 7 fois sur 10 sur un grand nombre de matchs.",
            "Avant le lancement, le modèle a été testé saison par saison sur des matchs qu'il n'avait jamais vus. Son avantage sur l'Elo seul est faible et n'est pas statistiquement certain, et nous le disons. Tous les chiffres, erreurs comprises, figurent dans la [fiche du modèle]({modelCard}) (en anglais).",
          ],
        },
        {
          heading: "Les niveaux de confiance",
          body: [
            "Le niveau dépend de la probabilité de l'équipe choisie : **Léger** de 50 % à 58 %, **Solide** de 58 % à 68 %, **Fort** au-delà de 68 %. Un pronostic Léger est proche du pile ou face, et il y a des surprises à tous les niveaux.",
          ],
        },
        {
          heading: "D'où viennent les trois raisons",
          body: [
            "Chaque raison s'appuie sur les facteurs qui ont le plus fait bouger la probabilité de ce match (mesurés avec les valeurs SHAP). Un modèle d'IA transforme ces facteurs en phrases courtes en anglais, en français et en espagnol, et chaque phrase est vérifiée : aucun chiffre absent des données du modèle, aucun vocabulaire de pari. Si une vérification échoue, un modèle de phrase fixe est utilisé à la place.",
          ],
        },
        {
          heading: "Publication et mises à jour des pronostics",
          body: [
            "Les pronostics de la semaine suivante sont publiés le mardi. Si une nouvelle importante tombe avant le coup d'envoi (un quarterback forfait, un changement de météo), le match est recalculé. Une nouvelle version n'apparaît que si le pronostic change ou si la probabilité bouge d'au moins 5 points, et toutes les versions restent visibles sur la page du match.",
            "Au coup d'envoi, le pronostic est verrouillé. Après le match, il est évalué d'après le score final.",
          ],
        },
        {
          heading: "Pourquoi vous pouvez vous fier au bilan",
          body: [
            "Les pronostics sont en ajout seul : une fois publié, un pronostic ne peut être ni modifié ni supprimé, seulement remplacé par une nouvelle version avant le coup d'envoi. Chaque pronostic est relié au précédent par une empreinte cryptographique : toute modification d'un ancien pronostic casserait la chaîne. La dernière empreinte est affichée dans le [bilan](/record) et la chaîne est vérifiée chaque jour.",
          ],
        },
        {
          heading: "Sources des données",
          body: [
            "Calendriers, résultats, actions de jeu, effectifs, hiérarchies et rapports de blessures : [nflverse](https://nflverse.com). Météo : [Open-Meteo](https://open-meteo.com) (CC BY 4.0). Les informations sur les stades sont nos propres données de référence. Les noms et abréviations des équipes sont utilisés uniquement sous forme de texte ; nous n'utilisons aucun logo ni aucune image officielle.",
          ],
        },
        {
          heading: "Contact",
          body: ["Questions, corrections ou presse : [{email}](mailto:{email})."],
        },
      ],
    },

    terms: {
      title: "Conditions d'utilisation",
      description:
        "Les règles d'utilisation d'EndzoneIQ, de ses fonctions gratuites et de l'offre Pro.",
      sections: [
        {
          heading: "Qui nous sommes",
          body: [
            "EndzoneIQ (endzoneiq.com, le « Service ») est exploité par {operator}, {address} (« nous »). Contact : [{email}](mailto:{email}). En utilisant le Service, vous acceptez ces conditions. Si vous ne les acceptez pas, merci de ne pas l'utiliser.",
          ],
        },
        {
          heading: "Ce qu'est le Service, et ce qu'il n'est pas",
          body: [
            "EndzoneIQ publie des analyses statistiques des matchs NFL à des fins de **divertissement et d'information**. Les pronostics et les probabilités sont des estimations d'un modèle. Ils peuvent être faux, et le sont souvent. **Rien sur le Service ne constitue un conseil de pari, financier ou professionnel**, et rien n'est garanti. Si vous choisissez de parier, vous le faites à vos risques et dans le respect des lois qui s'appliquent à vous. Voir [Jeu responsable](/responsible-gaming).",
            "EndzoneIQ est indépendant : il n'est ni affilié à la NFL ou à une équipe, ni approuvé ou parrainé par elles.",
          ],
        },
        {
          heading: "Qui peut l'utiliser",
          body: [
            "Vous devez avoir au moins 18 ans pour créer un compte. Vous êtes responsable de votre compte et de la confidentialité de votre mot de passe. Prévenez-nous immédiatement si vous pensez que quelqu'un d'autre l'a utilisé.",
          ],
        },
        {
          heading: "Offre gratuite, offre Pro et paiements",
          body: [
            "L'offre gratuite comprend tous les pronostics, leur probabilité de victoire et leur raison principale, le bilan complet et un nombre limité de questions à l'assistant par jour. L'offre Pro ajoute davantage, comme décrit sur la [page des tarifs](/pricing).",
            "Lorsque Pro sera disponible, il sera payé d'avance via notre prestataire de paiement, renouvelé automatiquement jusqu'à résiliation, et résiliable à tout moment depuis votre compte ; l'accès continue jusqu'à la fin de la période payée. Un essai gratuit, s'il est proposé, n'est accordé qu'une fois par compte. Les prix et fonctions peuvent changer ; un changement de prix ne s'applique jamais à une période déjà payée, et nous vous prévenons avant qu'il s'applique à la suivante. Vos droits légaux de consommateur, dont un éventuel droit de rétractation, ne sont pas affectés.",
          ],
        },
        {
          heading: "L'assistant IA",
          body: [
            "L'assistant répond à partir des données d'EndzoneIQ, mais ses réponses sont générées automatiquement et peuvent contenir des erreurs. Vérifiez tout ce qui est important. N'indiquez pas d'informations personnelles sensibles dans vos questions. Des limites de questions par jour s'appliquent.",
          ],
        },
        {
          heading: "Utilisation acceptable",
          body: [
            "Merci de ne pas :",
            [
              "aspirer, copier ou revendre en masse le contenu du Service, ni utiliser des outils automatisés qui le surchargent ;",
              "tenter de contourner les limites des offres, les contrôles d'accès ou les mesures de sécurité ;",
              "utiliser le Service pour enfreindre la loi ou nuire à autrui ;",
              "vous faire passer pour quelqu'un d'autre ou créer des comptes pour d'autres personnes sans leur accord.",
            ],
            "Nous pouvons suspendre ou fermer un compte qui enfreint ces règles.",
          ],
        },
        {
          heading: "Contenu et propriété intellectuelle",
          body: [
            "Les textes, le design, les résultats du modèle et le logiciel du Service nous appartiennent ou appartiennent à nos concédants. Vous pouvez partager des liens et citer des pronostics individuels en mentionnant EndzoneIQ. Les données de tiers (comme nflverse et Open-Meteo) restent soumises à leur propre licence. Les noms des équipes appartiennent à leurs titulaires et ne servent qu'à identifier les équipes.",
          ],
        },
        {
          heading: "Disponibilité et modifications",
          body: [
            "Nous faisons de notre mieux pour que le Service soit disponible et exact, mais il est fourni « en l'état », sans garantie d'aucune sorte dans la mesure permise par la loi. Les données peuvent être en retard ou erronées, et des fonctions peuvent changer ou disparaître. Nous pouvons modifier ces conditions ; en cas de changement important, nous l'annoncerons sur le site ou par e-mail, et continuer à utiliser le Service vaut acceptation des nouvelles conditions.",
          ],
        },
        {
          heading: "Responsabilité",
          body: [
            "Dans la mesure permise par la loi, nous ne sommes pas responsables des pertes résultant de décisions prises sur la base du Service, y compris des pertes au jeu, ni des pertes indirectes. Notre responsabilité totale envers vous est limitée au montant que vous nous avez payé au cours des 12 mois précédant la réclamation. Rien dans ces conditions ne limite une responsabilité que la loi interdit de limiter.",
          ],
        },
        {
          heading: "Arrêter d'utiliser le Service",
          body: [
            "Vous pouvez arrêter d'utiliser le Service et supprimer votre compte à tout moment depuis la [page de votre compte](/account). La suppression met fin à l'accès d'un éventuel abonnement et efface les données de votre compte, comme décrit dans la [politique de confidentialité](/privacy).",
          ],
        },
        {
          heading: "Droit applicable et litiges",
          body: [
            "Ces conditions sont régies par {law}. Si vous êtes consommateur, vous conservez la protection des lois impératives de votre pays de résidence et pouvez saisir ses tribunaux. Contactez-nous d'abord : la plupart des problèmes se règlent par e-mail.",
          ],
        },
      ],
    },

    privacy: {
      title: "Politique de confidentialité",
      description:
        "Les données personnelles collectées par EndzoneIQ, pourquoi, qui les traite, et vos droits.",
      sections: [
        {
          heading: "Qui est responsable",
          body: [
            "Le responsable du traitement est {operator}, {address}. Pour toute question ou demande liée à vos données, écrivez à [{email}](mailto:{email}).",
            "Nous collectons le moins possible. Vous pouvez consulter tous les pronostics et le bilan complet sans compte.",
          ],
        },
        {
          heading: "Ce que nous collectons",
          body: [
            [
              "**Compte :** votre adresse e-mail, une empreinte de votre mot de passe (jamais le mot de passe lui-même) ou votre connexion Google, et votre nom si Google le fournit.",
              "**Sessions :** un jeton de session, ainsi que l'adresse IP et le type de navigateur de chaque session, pour vous garder connecté et protéger les comptes.",
              "**Préférences :** langue, équipe favorite, équipes suivies et réglages des alertes.",
              "**Assistant :** les questions posées et les réponses données, et le nombre de jetons utilisés par chaque réponse.",
              "**Notifications push :** si vous les activez, l'adresse push fournie par votre navigateur.",
              "**Facturation (quand Pro sera disponible) :** votre offre, l'état de l'abonnement et la référence client du prestataire de paiement. Les données de carte sont traitées par le prestataire et ne nous parviennent jamais.",
              "**Mesure d'audience, seulement si vous l'acceptez :** les pages vues et quelques actions (comme poser une question à l'assistant), liées à un identifiant aléatoire stocké dans votre navigateur. Jamais votre e-mail ni votre nom.",
              "**Rapports d'erreur :** quand quelque chose ne fonctionne pas, des détails techniques comme l'adresse de la page, le type de navigateur et le message d'erreur.",
              "**Journaux du serveur :** notre hébergeur enregistre l'adresse IP et la page demandée à chaque visite, pour la sécurité et le dépannage.",
            ],
          ],
        },
        {
          heading: "Pourquoi nous les utilisons (et sur quelle base légale)",
          body: [
            [
              "Fournir le Service que vous avez demandé : votre compte, l'assistant, les alertes et Pro (exécution du contrat).",
              "Assurer la sécurité et le bon fonctionnement du Service : sessions, limites de débit, rapports d'erreur et journaux (notre intérêt légitime).",
              "Comprendre quelles pages sont utiles, grâce à la mesure d'audience (votre consentement, que vous pouvez retirer à tout moment).",
              "Envoyer l'e-mail hebdomadaire ou les alertes de changement de pronostic, seulement si vous les avez activés (votre consentement).",
              "Conserver les documents de facturation exigés par la loi (obligation légale).",
            ],
            "Nous ne vendons pas vos données, nous n'affichons pas de publicité et nous n'utilisons pas vos données pour entraîner des modèles d'IA.",
          ],
        },
        {
          heading: "Qui les traite pour nous",
          body: [
            "Nous faisons appel à quelques prestataires, chacun uniquement pour sa tâche :",
            [
              "**Hostinger** (hébergement et base de données) ;",
              "**Resend** (envoi des e-mails) ;",
              "**Google** (uniquement si vous choisissez de vous connecter avec Google) ;",
              "**Anthropic** (l'IA de l'assistant : votre question et les données nécessaires pour y répondre sont envoyées à l'API d'Anthropic pour générer la réponse) ;",
              "**PostHog**, région UE (mesure d'audience, uniquement avec votre consentement) ;",
              "**Sentry** (suivi des erreurs) ;",
              "**le service push de votre navigateur**, comme Google, Mozilla ou Apple (uniquement si vous activez les notifications push) ;",
              "**notre prestataire de paiement** (uniquement pour les abonnements Pro, quand ils seront disponibles).",
            ],
            "Certains de ces prestataires se trouvent hors de l'Espace économique européen, notamment aux États-Unis. Dans ce cas, le transfert est encadré par des garanties comme les clauses contractuelles types de la Commission européenne ou une décision d'adéquation.",
          ],
        },
        {
          heading: "Combien de temps nous les gardons",
          body: [
            [
              "Données du compte, préférences et historique de l'assistant : jusqu'à la suppression de votre compte.",
              "Sessions : jusqu'à 30 jours, supprimées à leur expiration. Liens de connexion et de réinitialisation : jusqu'à leur expiration (24 heures au plus).",
              "Notifications envoyées : 30 jours.",
              "Mesure d'audience : jusqu'à 12 mois.",
              "Rapports d'erreur : jusqu'à 90 jours.",
              "Documents de facturation : la durée exigée par la loi fiscale.",
            ],
          ],
        },
        {
          heading: "Vos droits",
          body: [
            "Vous pouvez accéder à vos données, les corriger, les exporter ou les supprimer, vous opposer à certains usages ou les limiter, et retirer votre consentement à tout moment.",
            [
              "**Exporter :** téléchargez tout ce que nous détenons sur votre compte depuis la [page de votre compte](/account).",
              "**Supprimer :** supprimez votre compte depuis la même page. Cela efface immédiatement votre compte, vos préférences, l'historique de l'assistant et vos adresses push ; un abonnement est d'abord résilié.",
              "**Cookies et mesure d'audience :** modifiez votre choix avec « Paramètres des cookies » en bas de chaque page.",
            ],
            "Pour toute autre demande, écrivez à [{email}](mailto:{email}) ; nous répondons sous un mois. Vous pouvez aussi déposer une réclamation auprès de l'autorité de protection des données de votre pays (en France, la CNIL).",
          ],
        },
        {
          heading: "Enfants",
          body: [
            "Le Service s'adresse aux adultes. Les comptes sont réservés aux personnes de 18 ans et plus, et nous ne collectons pas sciemment de données sur des enfants.",
          ],
        },
        {
          heading: "Sécurité",
          body: [
            "Les connexions sont chiffrées (HTTPS), les mots de passe sont hachés, la base de données n'est pas accessible depuis internet et l'accès aux systèmes de production est limité. Aucun système n'est parfaitement sûr ; si une violation de données vous concerne, nous vous en informerons comme la loi l'exige.",
          ],
        },
        {
          heading: "Modifications",
          body: [
            "Nous mettrons cette page à jour quand nos pratiques changent, avec la date en haut. Les changements importants seront annoncés sur le site ou par e-mail.",
          ],
        },
      ],
    },

    cookies: {
      title: "Politique de cookies",
      description:
        "Les cookies et le stockage du navigateur utilisés par EndzoneIQ, et comment modifier votre choix.",
      sections: [
        {
          heading: "Notre approche",
          body: [
            "EndzoneIQ n'utilise que ce dont il a besoin pour fonctionner, plus une mesure d'audience facultative qui reste désactivée tant que vous ne l'acceptez pas. Aucun cookie publicitaire, aucun traceur tiers. Vous pouvez modifier votre choix à tout moment avec « Paramètres des cookies » en bas de chaque page.",
          ],
        },
        {
          heading: "Strictement nécessaires (toujours actifs)",
          body: [
            [
              "**better-auth.session_token** (cookie, 30 jours) : vous garde connecté. Déposé uniquement quand vous vous connectez. La connexion avec Google dépose aussi un cookie de courte durée qui protège la connexion contre la falsification.",
              "**NEXT_LOCALE** (cookie, 1 an) : mémorise la langue choisie.",
              "**theme** (stockage du navigateur) : mémorise le mode sombre ou clair.",
              "**ez-consent** (stockage du navigateur) : mémorise votre choix concernant les cookies.",
            ],
            "Ils ne nécessitent pas de consentement, car le site ne peut pas fonctionner correctement sans eux.",
          ],
        },
        {
          heading: "Mesure d'audience (uniquement avec votre consentement)",
          body: [
            [
              "**ez-aid** (stockage du navigateur, jusqu'à ce que vous l'effaciez ou refusiez la mesure d'audience) : un identifiant aléatoire qui permet à PostHog (région UE) de compter les visites et de voir quelles pages sont utiles. Il n'est jamais relié à votre e-mail ni à votre nom.",
            ],
            "Si vous refusez ou retirez votre consentement, aucune donnée d'audience n'est envoyée et l'identifiant est supprimé.",
          ],
        },
        {
          heading: "Notifications push",
          body: [
            "Si vous activez les notifications push, votre navigateur enregistre un service worker et nous transmet une adresse push. Vous pouvez les désactiver depuis la [page de votre compte](/account) ou dans les réglages de votre navigateur.",
          ],
        },
        {
          heading: "Gérer les cookies dans votre navigateur",
          body: [
            "Vous pouvez aussi bloquer ou supprimer les cookies et les données de site dans les réglages de votre navigateur. Bloquer ceux qui sont nécessaires vous déconnectera et réinitialisera votre langue et votre thème.",
            "Pour en savoir plus sur l'utilisation de vos données : [politique de confidentialité](/privacy).",
          ],
        },
      ],
    },

    "responsible-gaming": {
      title: "Jeu responsable",
      description:
        "EndzoneIQ n'est pas un conseil de pari. Si vous pariez, que cela reste un jeu, et sachez où trouver de l'aide.",
      sections: [
        {
          heading: "Notre position",
          body: [
            "EndzoneIQ est fait pour les fans qui veulent comprendre les matchs. **Ce n'est pas un conseil de pari**, et aucun pronostic n'est une certitude : même les pronostics « Fort » perdent régulièrement. Le modèle n'a aucun avantage démontré sur les marchés de paris.",
            "Les paris sont réservés aux adultes (18 ans ou plus selon votre pays) et uniquement là où ils sont légaux.",
          ],
        },
        {
          heading: "Si vous pariez, que cela reste un jeu",
          body: [
            [
              "Fixez-vous un budget que vous pouvez vous permettre de perdre, et respectez-le.",
              "Ne cherchez jamais à vous refaire, et ne pariez jamais pour gagner de l'argent ou payer des factures.",
              "Ne pariez pas quand vous êtes contrarié, stressé ou après avoir bu.",
              "Faites des pauses, et gardez du temps pour d'autres activités.",
              "Utilisez les limites et l'auto-exclusion proposées par votre opérateur.",
            ],
          ],
        },
        {
          heading: "Signaux d'alerte",
          body: [
            "Miser plus que prévu, emprunter pour parier, le cacher à vos proches ou vous sentir anxieux quand vous ne pouvez pas parier sont des signes qu'il est peut-être temps d'arrêter et d'en parler à quelqu'un.",
          ],
        },
        {
          heading: "Où trouver de l'aide",
          body: [
            "Une aide gratuite et confidentielle :",
            [
              "**France :** Joueurs Info Service, 09 74 75 13 13, [joueurs-info-service.fr](https://www.joueurs-info-service.fr)",
              "**Canada :** [ConnexOntario](https://www.connexontario.ca), 1-866-531-2600, ou la ligne d'aide de votre province (au Québec : Jeu : aide et référence)",
              "**États-Unis :** National Problem Gambling Helpline, 1-800-GAMBLER, [ncpgambling.org](https://www.ncpgambling.org)",
              "**Royaume-Uni :** National Gambling Helpline, 0808 8020 133, [gamcare.org.uk](https://www.gamcare.org.uk)",
              "**Espagne :** [jugarbien.es](https://www.jugarbien.es)",
              "**Partout :** [Gamblers Anonymous](https://www.gamblersanonymous.org)",
            ],
          ],
        },
      ],
    },
  },
};

export default fr;
