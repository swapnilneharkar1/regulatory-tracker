// Source configuration — one entry per regulator, each with its tabs.
// This mirrors the REGULATORS config in the frontend HTML. If you add/change
// a source here, also update the matching entry in regulatory_tracker_live.html
// (used there only for labels / "Visit Source" links, not for fetching anymore).

// Shared keyword list for the NEWSLETTER sources below — matches articles about NBFCs and
// India's major banks specifically, out of each outlet's much broader general business feed.
// Extend this list any time a specific bank/NBFC needs to be tracked that isn't covered yet.
const BANK_NBFC_KEYWORDS = [
  'nbfc', 'non-banking financial', 'non banking financial',
  'rbi', 'reserve bank of india', 'monetary policy', 'repo rate',
  'state bank of india', ' sbi ', 'hdfc bank', 'hdfc ltd', 'icici bank',
  'axis bank', 'kotak mahindra bank', 'indusind bank', 'yes bank',
  'idfc first bank', 'idbi bank', 'canara bank', 'punjab national bank',
  'union bank of india', 'bank of baroda', 'bank of india', 'uco bank',
  'central bank of india', 'federal bank', 'south indian bank', 'karur vysya',
  'rbl bank', 'au small finance', 'equitas', 'ujjivan',
  'bajaj finance', 'bajaj finserv', 'muthoot finance', 'muthoot capital',
  'shriram finance', 'l&t finance', 'cholamandalam investment',
  'mahindra finance', 'tata capital', 'poonawalla fincorp',
  'aditya birla finance', 'piramal finance', 'manappuram finance',
  'housing finance', 'gold loan', 'microfinance', 'mfi sector',
  'psu bank', 'public sector bank', 'private sector bank', 'nbfc-mfi',
];

module.exports = {
  NEWSLETTER: {
    tabs: [
      {
        key: 'NEWSLETTER_0', label: 'Indian Express', cat: 'News',
        rss: 'https://indianexpress.com/feed/',
        src: 'https://indianexpress.com/section/business/banking-and-finance/',
        htmlParse: 'generic', keywordFilter: BANK_NBFC_KEYWORDS,
      },
      {
        key: 'NEWSLETTER_1', label: 'Times Now', cat: 'News',
        rss: null,
        src: 'https://www.timesnownews.com/business-economy',
        htmlParse: 'generic', headless: true, keywordFilter: BANK_NBFC_KEYWORDS,
      },
      {
        key: 'NEWSLETTER_2', label: 'Economic Times', cat: 'News',
        rss: 'https://economictimes.indiatimes.com/rssfeedsdefault.cms',
        src: 'https://economictimes.indiatimes.com/industry/banking/finance/banking',
        htmlParse: 'generic', keywordFilter: BANK_NBFC_KEYWORDS,
      },
      {
        key: 'NEWSLETTER_3', label: 'Business Standard', cat: 'News',
        rss: 'https://www.business-standard.com/rss/finance-103.rss',
        src: 'https://www.business-standard.com/finance',
        htmlParse: 'generic', keywordFilter: BANK_NBFC_KEYWORDS,
      },
    ]
  },
  SEBI: {
    tabs: [
      { key: 'SEBI_0', label: 'Circulars',           cat: 'Circulars',          sebiPaginate: 12, preferHtml: true, rss: 'https://www.sebi.gov.in/sebirss.xml', linkFilter: '/legal/circulars/',        src: 'https://www.sebi.gov.in/sebiweb/home/HomeAction.do?doListing=yes&sid=1&ssid=7&smid=0' },
      { key: 'SEBI_1', label: 'Master Circulars',    cat: 'Master Circular',    sebiPaginate: 6, preferHtml: true, rss: 'https://www.sebi.gov.in/sebirss.xml', linkFilter: '/legal/master-circulars/', src: 'https://www.sebi.gov.in/sebiweb/home/HomeAction.do?doListing=yes&sid=1&ssid=6&smid=0' },
      { key: 'SEBI_2', label: 'Informal Guidance',   cat: 'Informal Guidance',  rss: null,  src: 'https://www.sebi.gov.in/sebiweb/home/HomeAction.do?doListing=yes&sid=2&ssid=10&smid=0', htmlParse: 'generic' },
      { key: 'SEBI_3', label: 'Consultation Papers', cat: 'Consultation Paper', sebiPaginate: 12, preferHtml: true, rss: 'https://www.sebi.gov.in/sebirss.xml', linkFilter: '/reports-and-statistics/', src: 'https://www.sebi.gov.in/sebiweb/home/HomeAction.do?doListing=yes&sid=4&ssid=38&smid=35' },
      { key: 'SEBI_4', label: "FAQ's",               cat: 'FAQ',                rss: null,  src: 'https://www.sebi.gov.in/sebiweb/other/OtherAction.do', htmlParse: 'linklist' },
      { key: 'SEBI_5', label: 'Insider Trading',     cat: 'Insider Trading',    rss: null,  src: 'https://www.sebi.gov.in/sebiweb/home/HomeAction.do?doListing=yes&sid=2&ssid=11&smid=0', htmlParse: 'generic' },
      { key: 'SEBI_6', label: 'Orders of AO',        cat: 'Orders',             sebiPaginate: 12, preferHtml: true, rss: 'https://www.sebi.gov.in/sebirss.xml', linkFilter: '/enforcement/orders/', src: 'https://www.sebi.gov.in/sebiweb/home/HomeAction.do?doListing=yes&sid=2&ssid=9&smid=6' },
    ]
  },
  RBI: {
    tabs: [
      { key: 'RBI_0', label: 'Notifications',       cat: 'Notifications',       preferHtml: true, htmlParse: 'rbi_dated_docs', rss: 'https://www.rbi.org.in/notifications_rss.xml', src: 'https://www.rbi.org.in/Scripts/NotificationUser.aspx' },
      { key: 'RBI_1', label: 'Master Directions',   cat: 'Master Directions',   rss: null, src: 'https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx', htmlParse: 'rbi_dated_docs' },
      { key: 'RBI_2', label: 'Master Circulars',    cat: 'Master Circulars',    rss: null, src: 'https://www.rbi.org.in/scripts/BS_ViewMasterCirculardetails.aspx', htmlParse: 'rbi_dated_docs' },
      { key: 'RBI_3', label: 'Draft Notifications', cat: 'Draft Notifications', rss: null, src: 'https://www.rbi.org.in/Scripts/DraftNotificationsGuildelines.aspx', htmlParse: 'rbi_dated_docs' },
    ]
  },
  BSE: {
    tabs: [
      { key: 'BSE_0', label: 'Circulars to Listed Co.', cat: 'Circular', rss: null, src: 'https://www.bseindia.com/corporates/CirularToListedComp.html', htmlParse: 'generic', headless: true },
    ]
  },
  NSE: {
    tabs: [
      { key: 'NSE_0', label: 'Circulars (Equity)', cat: 'Circular', rss: null, src: 'https://www.nseindia.com/companies-listing/circular-for-listed-companies-equity-market', htmlParse: 'nse_next_data' },
    ]
  },
  IRDAI: {
    tabs: [
      { key: 'IRDAI_0', label: 'Notifications', cat: 'Notifications', rss: null, src: 'https://irdai.gov.in/notifications', htmlParse: 'generic' },
      { key: 'IRDAI_1', label: 'Circulars',     cat: 'Circulars',     rss: null, src: 'https://irdai.gov.in/circulars', htmlParse: 'generic' },
      { key: 'IRDAI_2', label: 'Guidelines',    cat: 'Guidelines',    rss: null, src: 'https://irdai.gov.in/guidelines', htmlParse: 'generic' },
    ]
  },
  IEPFA: {
    tabs: [
      { key: 'IEPFA_0', label: 'Rules',              cat: 'Rules',    rss: null, src: 'https://www.iepf.gov.in/content/iepf/global/master/Home/Notifications/rules.html', htmlParse: 'generic', headless: true },
      { key: 'IEPFA_1', label: 'Notices & Circulars',cat: 'Circular', rss: null, src: 'https://www.iepf.gov.in/content/iepf/global/master/Home/Notifications/notices-and-circulars.html', htmlParse: 'generic', headless: true },
      { key: 'IEPFA_2', label: 'Orders 7(3)&7(7)',   cat: 'Orders',   rss: null, src: 'https://www.iepf.gov.in/content/iepf/global/master/Home/Notifications/notices-and-orders-under-rule-7-3----7-7-.html', htmlParse: 'generic', headless: true },
    ]
  },
  MCA: {
    tabs: [
      { key: 'MCA_0', label: "What's New",           cat: 'Updates', rss: null, src: 'https://www.mca.gov.in/content/mca/global/en/home.html', htmlParse: 'mca_marquee', headless: true, warmupUrl: 'https://www.mca.gov.in/content/mca/global/en/home.html' },
      { key: 'MCA_1', label: 'ROC Adj. Orders',      cat: 'Orders',  rss: null, src: 'https://www.mca.gov.in/content/mca/global/en/data-and-reports/rd-roc-info/roc-adjudication-orders.html', htmlParse: 'generic', headless: true, clickButtonText: 'Filter', warmupUrl: 'https://www.mca.gov.in/content/mca/global/en/home.html' },
      { key: 'MCA_2', label: 'ROC Adj. (Off-sys)',   cat: 'Orders',  rss: null, src: 'https://www.mca.gov.in/content/mca/global/en/data-and-reports/rd-roc-info/roc-adjudication-orders/archive.html', htmlParse: 'generic', headless: true, clickButtonText: 'Filter', warmupUrl: 'https://www.mca.gov.in/content/mca/global/en/home.html' },
      { key: 'MCA_3', label: 'RD Adj. Orders',       cat: 'Orders',  rss: null, src: 'https://www.mca.gov.in/content/mca/global/en/data-and-reports/rd-roc-info/rd-adjudication-orders.html', htmlParse: 'generic', headless: true, clickButtonText: 'Filter', warmupUrl: 'https://www.mca.gov.in/content/mca/global/en/home.html' },
      { key: 'MCA_4', label: 'RD Adj. (Off-sys)',    cat: 'Orders',  rss: null, src: 'https://www.mca.gov.in/content/mca/global/en/data-and-reports/rd-roc-info/rd-adjudication-orders/archive.html', htmlParse: 'generic', headless: true, clickButtonText: 'Filter', warmupUrl: 'https://www.mca.gov.in/content/mca/global/en/home.html' },
    ]
  },
  NFRA: {
    tabs: [
      { key: 'NFRA_0', label: 'Circulars',           cat: 'Circulars',          rss: null, src: 'https://nfra.gov.in/document-category/circulars/', htmlParse: 'generic' },
      { key: 'NFRA_1', label: 'Orders',              cat: 'Orders',             rss: null, src: 'https://nfra.gov.in/document-category/orders/', htmlParse: 'generic' },
      { key: 'NFRA_2', label: 'Consultation Papers', cat: 'Consultation Paper', rss: null, src: 'https://nfra.gov.in/document-category/consultation-papers/', htmlParse: 'generic' },
      { key: 'NFRA_3', label: 'Inspection Reports',  cat: 'Inspection Report',  rss: null, src: 'https://nfra.gov.in/document-category/inspection-reports/', htmlParse: 'generic' },
    ]
  },
  PCAOB: {
    tabs: [
      { key: 'PCAOB_0', label: 'Updates & News', cat: 'News',        rss: null, src: 'https://pcaobus.org/all-updates-and-news-releases', htmlParse: 'generic', headless: true },
      { key: 'PCAOB_1', label: 'Enforcement',    cat: 'Enforcement', rss: null, src: 'https://pcaobus.org/all-enforcement-updates', htmlParse: 'generic', headless: true },
      { key: 'PCAOB_2', label: 'Inspection Reports', cat: 'Inspection Report', rss: null, src: 'https://pcaobus.org/docs/default-source/generated-reports/inspecton-reports-xml.xml', htmlParse: 'pcaob_xml' },
    ]
  }
};
