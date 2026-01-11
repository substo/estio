// lib/properties/locations.ts

export interface PropertyLocation {
    district_key: string;
    district_label: string;
    locations: {
        key: string;
        label: string;
    }[];
}

export const PROPERTY_LOCATIONS: PropertyLocation[] = [
    {
        "district_key": "paphos",
        "district_label": "Paphos",
        "locations": [
            // --- Paphos Town & Suburbs ---
            { "key": "paphos_town", "label": "Paphos Town" },
            { "key": "kato_paphos", "label": "Kato Paphos" },
            { "key": "tombs_of_the_kings", "label": "Tombs of The Kings" }, // Added (CRM ID: 926)
            { "key": "universal", "label": "Universal" }, // Added (CRM ID: 925)
            { "key": "moutallos", "label": "Moutallos" }, // Added (CRM ID: 933)
            { "key": "anavargos", "label": "Anavargos" },
            { "key": "geroskipou", "label": "Geroskipou" },
            { "key": "konia", "label": "Konia" },
            { "key": "mesogi", "label": "Mesogi" },
            { "key": "mesa_chorio", "label": "Mesa Chorio" },
            { "key": "tremithousa", "label": "Tremithousa" },
            { "key": "tsada", "label": "Tsada" },
            { "key": "chlorakas", "label": "Chlorakas" },
            { "key": "emba", "label": "Emba" },
            { "key": "kissonerga", "label": "Kissonerga" },
            { "key": "lemba", "label": "Lemba" }, // Fixed spelling (was lepma)
            { "key": "tala", "label": "Tala" },
            { "key": "kamares", "label": "Kamares (Tala)" }, // Added (CRM ID: 1426)
            { "key": "episkopi_paphos", "label": "Episkopi (Paphos)" },
            { "key": "armou", "label": "Armou" },
            { "key": "marathounta", "label": "Marathounta" },
            { "key": "koili", "label": "Koili" },

            // --- East of Paphos / Airport Area ---
            { "key": "acheleia", "label": "Acheleia" }, // Added (CRM ID: 769)
            { "key": "agia_varvara", "label": "Agia Varvara" }, // Added (CRM ID: 773)
            { "key": "timi", "label": "Timi" },
            { "key": "anarita", "label": "Anarita" }, // Fixed spelling (was anamita)
            { "key": "mandria_paphos", "label": "Mandria (Paphos)" },
            { "key": "nikokleia", "label": "Nikokleia" },
            { "key": "kouklia", "label": "Kouklia" },
            { "key": "secret_valley", "label": "Secret Valley" },
            { "key": "aphrodite_hills", "label": "Aphrodite Hills" },
            { "key": "choletria", "label": "Choletria" },
            { "key": "nata", "label": "Nata" }, // Added (CRM ID: 855)

            // --- West / Peyia Area ---
            { "key": "peyia", "label": "Peyia" },
            { "key": "coral_bay", "label": "Coral Bay" },
            { "key": "sea_caves", "label": "Sea Caves" },
            { "key": "st_george_peyia", "label": "St George (Peyia)" }, // Maps to Agios Georgios
            { "key": "akoursos", "label": "Akoursos" }, // Added (CRM ID: 779)
            { "key": "kathikas", "label": "Kathikas" },
            { "key": "arodes_kato", "label": "Kato Arodes" },
            { "key": "arodes_pano", "label": "Pano Arodes" },
            { "key": "ineia", "label": "Ineia" },
            { "key": "drouseia", "label": "Drouseia" },

            // --- Polis / Latchi Area ---
            { "key": "polis", "label": "Polis Chrysochous" },
            { "key": "prodromi", "label": "Prodromi" }, // Added (CRM ID: 931)
            { "key": "latchi", "label": "Latchi" },
            { "key": "neo_chorio", "label": "Neo Chorio" },
            { "key": "argaka", "label": "Argaka" },
            { "key": "gialia", "label": "Gialia" }, // Fixed spelling (was gylia)
            { "key": "agia_marina_chrysochous", "label": "Agia Marina Chrysochous" }, // Added
            { "key": "nea_dimmata", "label": "Nea Dimmata" }, // Added
            { "key": "pomos", "label": "Pomos" },
            { "key": "androlikou", "label": "Androlikou" }, // Added
            { "key": "steni", "label": "Steni" }, // Added
            { "key": "peristerona", "label": "Peristerona" }, // Added
            { "key": "lysos", "label": "Lysos" },
            { "key": "skoulli", "label": "Skoulli" }, // Added

            // --- Villages (Mid-Paphos / Wine Villages) ---
            { "key": "polemi", "label": "Polemi" }, // Added (Popular village)
            { "key": "stroumbi", "label": "Stroumbi" },
            { "key": "yiolou", "label": "Giolou" },
            { "key": "goudi", "label": "Goudi" },
            { "key": "kallepia", "label": "Kallepia" },
            { "key": "letymvou", "label": "Letymvou" },
            { "key": "simou", "label": "Simou" }, // Added
            { "key": "fyti", "label": "Fyti" },
            { "key": "amargeti", "label": "Amargeti" }, // Added
            { "key": "panagia", "label": "Panagia" }, // Added
            { "key": "statos_agios_fotios", "label": "Statos-Agios Fotios" }, // Added

            // --- Remaining Villages (Alphabetical/General) ---
            { "key": "agia_marina_kelokedaron", "label": "Agia Marina Kelokedaron" },
            { "key": "agia_marinouda", "label": "Agia Marinouda" },
            { "key": "agios_dimitrianos", "label": "Agios Dimitrianos" },
            { "key": "agios_ioannis", "label": "Agios Ioannis" },
            { "key": "agios_isidoros", "label": "Agios Isidoros" },
            { "key": "agios_nikolaos", "label": "Agios Nikolaos" },
            { "key": "akourdaleia_kato", "label": "Kato Akourdaleia" },
            { "key": "akourdaleia_pano", "label": "Pano Akourdaleia" },
            { "key": "anadiou", "label": "Anadiou" },
            { "key": "archimandrita", "label": "Archimandrita" },
            { "key": "arminou", "label": "Arminou" },
            { "key": "asprogia", "label": "Asprogia" },
            { "key": "axylou", "label": "Axylou" },
            { "key": "choli", "label": "Choli" },
            { "key": "choulou", "label": "Choulou" },
            { "key": "chrysochou_village", "label": "Chrysochou (village)" },
            { "key": "drymou", "label": "Drymou" },
            { "key": "eledio", "label": "Eledio" },
            { "key": "evretou", "label": "Evretou" },
            { "key": "falia", "label": "Falia" },
            { "key": "fasli", "label": "Fasli" },
            { "key": "fasoula", "label": "Fasoula" },
            { "key": "filousa_chrysochou", "label": "Filousa Chrysochou" },
            { "key": "filousa_kelokedaron", "label": "Filousa Kelokedaron" },
            { "key": "foinikas", "label": "Foinikas" },
            { "key": "galataria", "label": "Galataria" },
            { "key": "galia", "label": "Galia" },
            { "key": "kannaviou", "label": "Kannaviou" },
            { "key": "karamoullides", "label": "Karamoullides" },
            { "key": "kedares", "label": "Kedares" },
            { "key": "kelokedara", "label": "Kelokedara" },
            { "key": "kidasi", "label": "Kidasi" },
            { "key": "kios", "label": "Kios" },
            { "key": "koilineia", "label": "Koilineia" },
            { "key": "koloni", "label": "Koloni" },
            { "key": "kourdaka", "label": "Kourdaka" },
            { "key": "kritou_marottou", "label": "Kritou Marottou" },
            { "key": "kritou_tera", "label": "Kritou Tera" },
            { "key": "kynousa", "label": "Kynousa" },
            { "key": "lapithiou", "label": "Lapithiou" },
            { "key": "lasa", "label": "Lasa" },
            { "key": "lemona", "label": "Lemona" },
            { "key": "loukrounou", "label": "Loukrounou" }, // Fixed spelling (was loutrou)
            { "key": "makounta", "label": "Makounta" },
            { "key": "mamonia", "label": "Mamonia" },
            { "key": "mamountali", "label": "Mamountali" },
            { "key": "maronas", "label": "Maronas" },
            { "key": "meladeia", "label": "Meladeia" },
            { "key": "melandra", "label": "Melandra" },
            { "key": "mesaana", "label": "Mesaana" },
            { "key": "mesana", "label": "Mesana" },
            { "key": "milia", "label": "Milia" },
            { "key": "milikouri", "label": "Milikouri" },
            { "key": "miliou", "label": "Miliou" },
            { "key": "mousere", "label": "Mousere" },
            { "key": "pelathousa", "label": "Pelathousa" },
            { "key": "pentalia", "label": "Pentalia" },
            { "key": "pitargou", "label": "Pitargou" },
            { "key": "praitori", "label": "Praitori" },
            { "key": "prastio", "label": "Prastio" },
            { "key": "psathi", "label": "Psathi" },
            { "key": "salamiou", "label": "Salamiou" },
            { "key": "sarama", "label": "Sarama" },
            { "key": "souskiou", "label": "Souskiou" },
            { "key": "stavrokonnou", "label": "Stavrokonnou" },
            { "key": "tera", "label": "Tera" },
            { "key": "theletra", "label": "Theletra" },
            { "key": "thrinia", "label": "Thrinia" },
            { "key": "trachypedoula", "label": "Trachypedoula" },
            { "key": "trimithousa", "label": "Trimithousa" },
            { "key": "vrestia", "label": "Vrestia" },
            { "key": "zacharia", "label": "Zacharia" }
        ]
    },
    {
        "district_key": "limassol",
        "district_label": "Limassol",
        "locations": [
            { "key": "limassol_city", "label": "Limassol City" },
            { "key": "germasogeia", "label": "Germasogeia" },
            { "key": "agios_athanasios", "label": "Agios Athanasios" },
            { "key": "mesa_geitonia", "label": "Mesa Geitonia" },
            { "key": "kato_polemidia", "label": "Kato Polemidia" },
            { "key": "ypsonas", "label": "Ypsonas" },
            { "key": "kolossi", "label": "Kolossi" },
            { "key": "erimi", "label": "Erimi" },
            { "key": "episkopi_limassol", "label": "Episkopi (Limassol)" },
            { "key": "akrotiri", "label": "Akrotiri" },
            { "key": "parekklisia", "label": "Parekklisia" },
            { "key": "pyrgos_limassol", "label": "Pyrgos (Limassol)" },
            { "key": "monagroulli", "label": "Monagroulli" },
            { "key": "moni", "label": "Moni" },
            { "key": "pissouri", "label": "Pissouri" },
            { "key": "agros", "label": "Agros" },
            { "key": "platres_kato", "label": "Kato Platres" },
            { "key": "platres_pano", "label": "Pano Platres" },
            { "key": "troodos_resort", "label": "Troodos Resort Area" }
        ]
    },
    {
        "district_key": "larnaca",
        "district_label": "Larnaca",
        "locations": [
            { "key": "larnaca_city", "label": "Larnaca City" },
            { "key": "aradippou", "label": "Aradippou" },
            { "key": "athienou", "label": "Athienou" },
            { "key": "dromolaxia_meneou", "label": "Dromolaxia–Meneou" },
            { "key": "livadia", "label": "Livadia" },
            { "key": "lefkara_pano", "label": "Pano Lefkara" },
            { "key": "lefkara_kato", "label": "Kato Lefkara" },
            { "key": "voroklini_oroklini", "label": "Oroklini (Voroklini)" },
            { "key": "pyla", "label": "Pyla" },
            { "key": "xylotymbou", "label": "Xylotymbou" },
            { "key": "kiti", "label": "Kiti" },
            { "key": "pervolia", "label": "Pervolia" },
            { "key": "mazotos", "label": "Mazotos" },
            { "key": "kofinou", "label": "Kofinou" },
            { "key": "kornokipos", "label": "Kornos" }
        ]
    },
    {
        "district_key": "nicosia",
        "district_label": "Nicosia",
        "locations": [
            { "key": "nicosia_city", "label": "Nicosia City" },
            { "key": "strovolos", "label": "Strovolos" },
            { "key": "lakatamia", "label": "Lakatamia" },
            { "key": "latsia", "label": "Latsia" },
            { "key": "aglandjia", "label": "Aglantzia" },
            { "key": "agios_dometios", "label": "Agios Dometios" },
            { "key": "engomi", "label": "Engomi" },
            { "key": "tseri", "label": "Tseri" },
            { "key": "geri", "label": "Geri" },
            { "key": "dali", "label": "Dali" },
            { "key": "kokkinotrimithia", "label": "Kokkinotrimithia" },
            { "key": "lathrodontas", "label": "Lythrodontas" },
            { "key": "peristerona_nicosia", "label": "Peristerona (Nicosia)" }
        ]
    },
    {
        "district_key": "famagusta",
        "district_label": "Famagusta (Ammochostos)",
        "locations": [
            { "key": "paralimni", "label": "Paralimni" },
            { "key": "protaras", "label": "Protaras" },
            { "key": "kapparis", "label": "Kapparis" },
            { "key": "ayia_napa", "label": "Ayia Napa" },
            { "key": "deryneia", "label": "Deryneia" },
            { "key": "sotira_famagusta", "label": "Sotira" },
            { "key": "liopetri", "label": "Liopetri" },
            { "key": "avgorou", "label": "Avgorou" },
            { "key": "frenaros", "label": "Frenaros" }
        ]
    }
];