import type { SupportedLanguage } from '../types/spark';

export interface TranslationStrings {
  heroTitle: string;
  heroSubphrases: string[];
  composerPlaceholder: string;
  sendButton: string;
  quickActions: {
    findProducts: string;
    searchCoupons: string;
    comparePrices: string;
    discoverOffers: string;
    findAlternatives: string;
  };
  nav: {
    conversation: string;
    discovery: string;
    coupons: string;
    comparison: string;
    saved: string;
    cart: string;
    purchases: string;
    settings: string;
  };
  emptyPurchasesTitle: string;
  emptyPurchasesDesc: string;
  returnToSpark: string;
  settingsTitle: string;
  callYouPrompt: string;
  paypalSectionTitle: string;
}

export const TRANSLATIONS: Record<SupportedLanguage, TranslationStrings> = {
  en: {
    heroTitle: 'Spark can do it.',
    heroSubphrases: [
      'Find something better.',
      'Discover smarter deals.',
      'Compare before you buy.',
      'Your next purchase starts here.',
    ],
    composerPlaceholder: 'What are you looking for today?',
    sendButton: 'Ask Spark',
    quickActions: {
      findProducts: 'Find products',
      searchCoupons: 'Search coupons',
      comparePrices: 'Compare prices',
      discoverOffers: 'Discover offers',
      findAlternatives: 'Find alternatives',
    },
    nav: {
      conversation: 'New Conversation',
      discovery: 'Product Discovery',
      coupons: 'Coupons & Deals',
      comparison: 'Price Comparisons',
      saved: 'Saved Products',
      cart: 'Shopping Cart',
      purchases: 'Purchases',
      settings: 'Settings',
    },
    emptyPurchasesTitle: 'No purchases yet.',
    emptyPurchasesDesc:
      'When you review and confirm a purchase through PayPal, verified order records and transaction references will appear here.',
    returnToSpark: 'Start discovering with Spark',
    settingsTitle: 'Settings & Personalization',
    callYouPrompt: 'What would you like Spark to call you?',
    paypalSectionTitle: 'PayPal Account Connection',
  },
  es: {
    heroTitle: 'Spark puede hacerlo.',
    heroSubphrases: [
      'Encuentra algo mejor.',
      'Descubre ofertas más inteligentes.',
      'Compara antes de comprar.',
      'Tu próxima compra comienza aquí.',
    ],
    composerPlaceholder: '¿Qué estás buscando hoy?',
    sendButton: 'Preguntar a Spark',
    quickActions: {
      findProducts: 'Buscar productos',
      searchCoupons: 'Buscar cupones',
      comparePrices: 'Comparar precios',
      discoverOffers: 'Descubrir ofertas',
      findAlternatives: 'Buscar alternativas',
    },
    nav: {
      conversation: 'Nueva Conversación',
      discovery: 'Descubrir Productos',
      coupons: 'Cupones y Ofertas',
      comparison: 'Comparar Precios',
      saved: 'Productos Guardados',
      cart: 'Carrito de Compras',
      purchases: 'Compras',
      settings: 'Configuración',
    },
    emptyPurchasesTitle: 'Aún no hay compras.',
    emptyPurchasesDesc:
      'Cuando revises y confirmes una compra mediante PayPal, los registros verificados aparecerán aquí.',
    returnToSpark: 'Descubrir productos con Spark',
    settingsTitle: 'Configuración y Personalización',
    callYouPrompt: '¿Cómo te gustaría que te llame Spark?',
    paypalSectionTitle: 'Conexión de Cuenta PayPal',
  },
  fr: {
    heroTitle: 'Spark peut le faire.',
    heroSubphrases: [
      'Trouvez quelque chose de mieux.',
      'Découvrez des offres plus intelligentes.',
      'Comparez avant d’acheter.',
      'Votre prochain achat commence ici.',
    ],
    composerPlaceholder: 'Que recherchez-vous aujourd’hui ?',
    sendButton: 'Demander à Spark',
    quickActions: {
      findProducts: 'Trouver des produits',
      searchCoupons: 'Chercher des coupons',
      comparePrices: 'Comparer les prix',
      discoverOffers: 'Découvrir les offres',
      findAlternatives: 'Trouver des alternatives',
    },
    nav: {
      conversation: 'Nouvelle Conversation',
      discovery: 'Découverte Produits',
      coupons: 'Coupons et Offres',
      comparison: 'Comparaisons de Prix',
      saved: 'Produits Enregistrés',
      cart: 'Panier d’Achat',
      purchases: 'Achats',
      settings: 'Paramètres',
    },
    emptyPurchasesTitle: 'Aucun achat pour le moment.',
    emptyPurchasesDesc:
      'Lorsque vous confirmez un achat via PayPal, les transactions vérifiées apparaîtront ici.',
    returnToSpark: 'Découvrir avec Spark',
    settingsTitle: 'Paramètres et Personnalisation',
    callYouPrompt: 'Comment souhaitez-vous que Spark vous appelle ?',
    paypalSectionTitle: 'Connexion Compte PayPal',
  },
  de: {
    heroTitle: 'Spark erledigt das.',
    heroSubphrases: [
      'Finden Sie etwas Besseres.',
      'Entdecken Sie klügere Angebote.',
      'Vergleichen Sie vor dem Kauf.',
      'Ihr nächster Einkauf beginnt hier.',
    ],
    composerPlaceholder: 'Wonach suchen Sie heute?',
    sendButton: 'Spark fragen',
    quickActions: {
      findProducts: 'Produkte finden',
      searchCoupons: 'Gutscheine suchen',
      comparePrices: 'Preise vergleichen',
      discoverOffers: 'Angebote entdecken',
      findAlternatives: 'Alternativen finden',
    },
    nav: {
      conversation: 'Neue Konversation',
      discovery: 'Produktentdeckung',
      coupons: 'Gutscheine & Deals',
      comparison: 'Preisvergleich',
      saved: 'Gespeicherte Produkte',
      cart: 'Warenkorb',
      purchases: 'Käufe',
      settings: 'Einstellungen',
    },
    emptyPurchasesTitle: 'Noch keine Käufe.',
    emptyPurchasesDesc:
      'Sobald Sie einen Kauf über PayPal bestätigen, werden verifizierte Transaktionen hier angezeigt.',
    returnToSpark: 'Mit Spark entdecken',
    settingsTitle: 'Einstellungen & Personalisierung',
    callYouPrompt: 'Wie soll Spark Sie ansprechen?',
    paypalSectionTitle: 'PayPal-Kontoverbindung',
  },
  ja: {
    heroTitle: 'Sparkにおまかせください。',
    heroSubphrases: [
      'より良い選択を見つけましょう。',
      'スマートな割引を発見。',
      '購入前にしっかり比較。',
      '次のショッピングはここから始まります。',
    ],
    composerPlaceholder: '今日は何をお探しですか？',
    sendButton: 'Sparkに聞く',
    quickActions: {
      findProducts: '商品を探す',
      searchCoupons: 'クーポン検索',
      comparePrices: '価格を比較',
      discoverOffers: 'オファーを発見',
      findAlternatives: '代替品を探す',
    },
    nav: {
      conversation: '新しい会話',
      discovery: '商品ディスカバリー',
      coupons: 'クーポンとセール',
      comparison: '価格比較',
      saved: '保存した商品',
      cart: 'ショッピングカート',
      purchases: '購入履歴',
      settings: '設定',
    },
    emptyPurchasesTitle: '購入履歴はまだありません。',
    emptyPurchasesDesc:
      'PayPalで購入を確認・完了すると、検証済みの取引履歴がここに表示されます。',
    returnToSpark: 'Sparkで商品を探す',
    settingsTitle: '設定とパーソナライズ',
    callYouPrompt: 'Sparkからの呼び名を設定してください',
    paypalSectionTitle: 'PayPalアカウント連携',
  },
};
