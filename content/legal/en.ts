import type { LegalContent } from "./types";

const en: LegalContent = {
  updated: "Last updated {updated}",
  contents: "On this page",
  docs: {
    about: {
      title: "About EndzoneIQ and how the model works",
      description:
        "What EndzoneIQ is, where its data comes from, and how every pick is made, published and graded.",
      sections: [
        {
          heading: "What EndzoneIQ is",
          body: [
            "EndzoneIQ helps NFL fans understand every game in about 60 seconds: a pick, a win probability, a confidence tier and three plain-English reasons. It is fan analysis, **not a betting service**, and it is not affiliated with the NFL or any team.",
            "Every pick we publish stays on the [track record](/record), wins and losses alike.",
          ],
        },
        {
          heading: "The model in plain language",
          body: [
            "The starting point is an Elo rating for each team: a single number that goes up when a team wins and down when it loses, by more when the result was a surprise. Elo alone already makes sensible picks.",
            "On top of Elo, a machine-learning model (LightGBM) learns small corrections from things Elo can't see:",
            [
              "how efficient each offense and defense has been, play by play (EPA and success rate), including passing, running, explosive plays and turnovers;",
              "a change at quarterback, and injured starters ruled out or doubtful;",
              "rest days, short weeks, byes, travel distance and time zones crossed;",
              "neutral sites, division games and playoffs;",
              "weather for outdoor games: wind and temperature.",
            ],
            "The model never uses betting lines, so it stays independent of the market. Its probabilities are calibrated: when it says 70%, the picked team should win about 7 times in 10 over many games.",
            "Before launch the model was tested season by season on games it had never seen. Its edge over Elo alone is small and not statistically certain, and we say so. The full numbers, including the misses, are in the [model card]({modelCard}).",
          ],
        },
        {
          heading: "Confidence tiers",
          body: [
            "The tier comes from the picked team's probability: **Lean** from 50% to 58%, **Solid** from 58% to 68%, **Strong** above 68%. A Lean is close to a coin flip, and upsets happen in every tier.",
          ],
        },
        {
          heading: "Where the three reasons come from",
          body: [
            "Each reason is built from the factors that moved that game's probability the most (measured with SHAP values). An AI model turns those factors into short sentences in English, French and Spanish, and every sentence is checked: no number may appear that isn't in the model's data, and no betting language is allowed. If a check fails, a fixed template is used instead.",
          ],
        },
        {
          heading: "When picks are published and updated",
          body: [
            "Picks for the coming week are published on Tuesday. If important news arrives before kickoff (a quarterback ruled out, a change in the weather), the game is predicted again. A new version appears only when the pick changes or the probability moves by at least 5 points, and every version stays visible on the game page.",
            "At kickoff the pick is locked. After the game it is graded from the final score.",
          ],
        },
        {
          heading: "Why you can trust the record",
          body: [
            "Picks are append-only: once published, a pick can't be edited or deleted, only replaced by a newer version before kickoff. Each pick is linked to the one before it by a cryptographic hash, so any change to an old pick would break the chain. The latest hash is shown on the [track record](/record) and the chain is verified every day.",
          ],
        },
        {
          heading: "Data sources",
          body: [
            "Schedules, results, play-by-play, rosters, depth charts and injury reports come from [nflverse](https://nflverse.com). Weather comes from [Open-Meteo](https://open-meteo.com) (CC BY 4.0). Stadium details are our own reference data. Team names and abbreviations are used as text only; we use no logos or official imagery.",
          ],
        },
        {
          heading: "Contact",
          body: ["Questions, corrections or press: [{email}](mailto:{email})."],
        },
      ],
    },

    terms: {
      title: "Terms of Use",
      description: "The rules for using EndzoneIQ, its free features and its Pro plan.",
      sections: [
        {
          heading: "Who we are",
          body: [
            "EndzoneIQ (endzoneiq.com, the “Service”) is operated by {operator}, {address} (“we”). Contact: [{email}](mailto:{email}). By using the Service you agree to these terms. If you don't agree, please don't use it.",
          ],
        },
        {
          heading: "What the Service is, and what it is not",
          body: [
            "EndzoneIQ publishes statistical analysis of NFL games for **entertainment and information**. Picks and probabilities are estimates from a model. They can be wrong, and often are. **Nothing on the Service is betting, financial or professional advice**, and nothing is guaranteed. If you choose to bet, you do so at your own risk and under the laws that apply to you. See [Responsible gaming](/responsible-gaming).",
            "EndzoneIQ is independent and is not affiliated with, endorsed by or sponsored by the NFL or any team.",
          ],
        },
        {
          heading: "Who can use it",
          body: [
            "You must be at least 18 years old to create an account. You are responsible for your account and for keeping your password safe. Tell us right away if you think someone else has used it.",
          ],
        },
        {
          heading: "Free plan, Pro plan and payments",
          body: [
            "The free plan includes every pick, its win probability and top reason, the full track record and a limited number of assistant questions per day. The Pro plan adds more, as described on the [pricing page](/pricing).",
            "When Pro is available, it is billed in advance through our payment provider, renews automatically until you cancel, and can be cancelled at any time from your account; access continues until the end of the paid period. A free trial, when offered, is available once per account. Prices and features may change; a price change never applies to a period you have already paid for, and we'll tell you before it applies to the next one. Statutory rights you have as a consumer, including any right of withdrawal, are not affected.",
          ],
        },
        {
          heading: "The AI assistant",
          body: [
            "The assistant answers using EndzoneIQ's own data, but its answers are generated automatically and may contain mistakes. Check anything important. Don't enter sensitive personal information in your questions. Daily question limits apply.",
          ],
        },
        {
          heading: "Acceptable use",
          body: [
            "Please don't:",
            [
              "scrape, copy or resell the Service's content in bulk, or use automated tools that put unusual load on it;",
              "try to get around the plan limits, access controls or security measures;",
              "use the Service to break the law or to harm others;",
              "pretend to be someone else or create accounts for other people without their consent.",
            ],
            "We may suspend or close an account that breaks these rules.",
          ],
        },
        {
          heading: "Content and intellectual property",
          body: [
            "The Service's text, design, model outputs and software belong to us or our licensors. You may share links and quote individual picks with credit to EndzoneIQ. Data from third parties (such as nflverse and Open-Meteo) remains subject to its own licence. Team names are the property of their owners and are used only to identify the teams.",
          ],
        },
        {
          heading: "Availability and changes",
          body: [
            "We try to keep the Service available and accurate, but it is provided “as is”, without warranties of any kind to the extent the law allows. Data can be late or wrong, and features may change or stop. We may update these terms; if a change is significant we'll announce it on the site or by email, and continuing to use the Service means you accept the new terms.",
          ],
        },
        {
          heading: "Liability",
          body: [
            "To the extent the law allows, we are not liable for any loss arising from decisions you make based on the Service, including betting losses, or for indirect losses. Our total liability to you is limited to the amount you paid us in the 12 months before the claim. Nothing in these terms limits liability that can't be limited by law.",
          ],
        },
        {
          heading: "Ending your use",
          body: [
            "You can stop using the Service and delete your account at any time from your [account page](/account). Deleting the account ends any subscription access and erases your account data, as described in the [privacy policy](/privacy).",
          ],
        },
        {
          heading: "Law and disputes",
          body: [
            "These terms are governed by {law}. If you are a consumer, you also keep the protection of the mandatory laws of the country where you live, and you may bring a claim in its courts. Please contact us first: most problems can be solved by email.",
          ],
        },
      ],
    },

    privacy: {
      title: "Privacy Policy",
      description: "What personal data EndzoneIQ collects, why, who processes it, and your rights.",
      sections: [
        {
          heading: "Who is responsible",
          body: [
            "The data controller is {operator}, {address}. For any privacy question or request, write to [{email}](mailto:{email}).",
            "We collect as little as we can. You can read every pick and the full track record without an account.",
          ],
        },
        {
          heading: "What we collect",
          body: [
            [
              "**Account:** your email address, a password hash (never the password itself) or your Google sign-in, and your name if Google provides it.",
              "**Sessions:** a session token, plus the IP address and browser type of each session, used to keep you signed in and to protect accounts.",
              "**Preferences:** language, favourite team, followed teams and alert settings.",
              "**Assistant:** the questions you ask and the answers given, and how many tokens each answer used.",
              "**Push notifications:** if you turn them on, the push address your browser gives us.",
              "**Billing (when Pro is available):** your plan, subscription status and the payment provider's customer reference. Card details are handled by the payment provider and never reach us.",
              "**Analytics, only if you accept them:** pages viewed and a few actions (such as asking the assistant a question), tied to a random identifier stored in your browser. Never your email or name.",
              "**Error reports:** when something breaks, technical details such as the page address, browser type and the error message.",
              "**Server logs:** our host records the IP address and requested page of each visit for security and troubleshooting.",
            ],
          ],
        },
        {
          heading: "Why we use it (and our legal basis)",
          body: [
            [
              "To provide the Service you asked for: your account, the assistant, alerts and Pro (performance of a contract).",
              "To keep the Service secure and working: sessions, rate limits, error reports and server logs (our legitimate interest).",
              "To understand which pages are useful, with analytics (your consent, which you can withdraw at any time).",
              "To send the weekly email or pick-change alerts, only if you turned them on (your consent).",
              "To keep billing records required by law (legal obligation).",
            ],
            "We don't sell your data, we don't show ads, and we don't use your data to train AI models.",
          ],
        },
        {
          heading: "Who processes it for us",
          body: [
            "We use a small number of service providers, each only for its task:",
            [
              "**Hostinger** (hosting and database);",
              "**Resend** (sending emails);",
              "**Google** (only if you choose to sign in with Google);",
              "**Anthropic** (the AI behind the assistant: your question and the data needed to answer it are sent to Anthropic's API to generate the answer);",
              "**PostHog**, EU region (analytics, only with your consent);",
              "**Sentry** (error monitoring);",
              "**your browser's push service**, such as Google, Mozilla or Apple (only if you turn on push notifications);",
              "**our payment provider** (only for Pro subscriptions, when available).",
            ],
            "Some of these providers are outside the European Economic Area, notably in the United States. Where that happens, the transfer is covered by safeguards such as the European Commission's standard contractual clauses or an adequacy decision.",
          ],
        },
        {
          heading: "How long we keep it",
          body: [
            [
              "Account data, preferences and assistant history: until you delete your account.",
              "Sessions: up to 30 days, deleted once they expire. Sign-in and reset links: until they expire (24 hours at most).",
              "Sent notifications: 30 days.",
              "Analytics: up to 12 months.",
              "Error reports: up to 90 days.",
              "Billing records: as long as tax law requires.",
            ],
          ],
        },
        {
          heading: "Your rights",
          body: [
            "You can access, correct, export or delete your data, object to or restrict some uses, and withdraw consent at any time.",
            [
              "**Export:** download everything we hold about your account from your [account page](/account).",
              "**Delete:** delete your account from the same page. It erases your account, preferences, assistant history and push addresses immediately; a subscription is cancelled first.",
              "**Cookies and analytics:** change your choice from “Cookie settings” at the bottom of every page.",
            ],
            "For anything else, write to [{email}](mailto:{email}); we answer within one month. You can also complain to the data protection authority where you live.",
          ],
        },
        {
          heading: "Children",
          body: [
            "The Service is meant for adults. Accounts are for people aged 18 and over, and we don't knowingly collect data from children.",
          ],
        },
        {
          heading: "Security",
          body: [
            "Connections are encrypted (HTTPS), passwords are hashed, the database is not reachable from the internet, and access to production systems is limited. No system is perfectly secure; if a breach affects you, we'll tell you as the law requires.",
          ],
        },
        {
          heading: "Changes",
          body: [
            "We'll update this page when our practices change and note the date at the top. Significant changes will be announced on the site or by email.",
          ],
        },
      ],
    },

    cookies: {
      title: "Cookie Policy",
      description: "The cookies and browser storage EndzoneIQ uses, and how to change your choice.",
      sections: [
        {
          heading: "Our approach",
          body: [
            "EndzoneIQ uses only what it needs to work, plus optional analytics that stay off until you accept them. There are no advertising cookies and no third-party trackers. You can change your choice at any time with “Cookie settings” at the bottom of every page.",
          ],
        },
        {
          heading: "Strictly necessary (always on)",
          body: [
            [
              "**better-auth.session_token** (cookie, 30 days): keeps you signed in. Only set when you sign in. Signing in with Google also sets a short-lived cookie that protects the sign-in from forgery.",
              "**NEXT_LOCALE** (cookie, 1 year): remembers the language you chose.",
              "**theme** (browser storage): remembers dark or light mode.",
              "**ez-consent** (browser storage): remembers your cookie choice.",
            ],
            "These don't need consent because the site can't work properly without them.",
          ],
        },
        {
          heading: "Analytics (only with your consent)",
          body: [
            [
              "**ez-aid** (browser storage, until you clear it or refuse analytics): a random identifier so PostHog (EU region) can count visits and see which pages are useful. It is never linked to your email or name.",
            ],
            "If you refuse or withdraw consent, no analytics are sent and the identifier is deleted.",
          ],
        },
        {
          heading: "Push notifications",
          body: [
            "If you turn on push notifications, your browser registers a service worker and gives us a push address. You can turn them off from your [account page](/account) or in your browser settings.",
          ],
        },
        {
          heading: "Managing cookies in your browser",
          body: [
            "You can also block or delete cookies and site data in your browser settings. Blocking the necessary ones will sign you out and reset your language and theme.",
            "More about how we use data: [privacy policy](/privacy).",
          ],
        },
      ],
    },

    "responsible-gaming": {
      title: "Responsible gaming",
      description:
        "EndzoneIQ is not betting advice. If you bet, keep it fun, and know where to find help.",
      sections: [
        {
          heading: "Our position",
          body: [
            "EndzoneIQ is made for fans who want to understand games. **It is not betting advice**, and no pick is a sure thing: even “Strong” picks lose regularly. The model has no proven edge over betting markets.",
            "Betting is for adults only (18+ or 21+, depending on where you live) and only where it is legal.",
          ],
        },
        {
          heading: "If you bet, keep it a game",
          body: [
            [
              "Set a budget you can afford to lose, and stick to it.",
              "Never chase losses, and never bet to make money or pay bills.",
              "Don't bet when you're upset, stressed or have been drinking.",
              "Take breaks, and keep time for other things you enjoy.",
              "Use the limits and self-exclusion tools your operator offers.",
            ],
          ],
        },
        {
          heading: "Warning signs",
          body: [
            "Betting more than you planned, borrowing to bet, hiding it from people close to you, or feeling anxious when you can't bet are signs it may be time to stop and talk to someone.",
          ],
        },
        {
          heading: "Where to find help",
          body: [
            "Free, confidential support:",
            [
              "**United States:** National Problem Gambling Helpline, 1-800-GAMBLER, [ncpgambling.org](https://www.ncpgambling.org)",
              "**Canada:** [ConnexOntario](https://www.connexontario.ca), 1-866-531-2600, or your province's helpline",
              "**United Kingdom:** National Gambling Helpline, 0808 8020 133, [gamcare.org.uk](https://www.gamcare.org.uk)",
              "**France:** Joueurs Info Service, 09 74 75 13 13, [joueurs-info-service.fr](https://www.joueurs-info-service.fr)",
              "**Spain:** [jugarbien.es](https://www.jugarbien.es)",
              "**Anywhere:** [Gamblers Anonymous](https://www.gamblersanonymous.org)",
            ],
          ],
        },
      ],
    },
  },
};

export default en;
