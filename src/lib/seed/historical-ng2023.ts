/**
 * HISTORICAL 2023 DATA (real, not synthetic) — small attributed sample. GENERATED; do not edit by hand.
 *
 * Source: Nigeria 2.0 independent, volunteer-run crosscheck of 2023 presidential polling-unit result
 * sheets against INEC IReV — https://github.com/nigeria2/data-ng-election-2023 (2023_data/FCT_crosschecked.csv).
 * The repository has NO licence file; its README describes the data as "open data … provided as-is
 * for transparency and research". Imported as a small attributed sample (FCT · ABAJI LGA, 130 units,
 * "crosschecked" set only) by explicit decision of the project owner on 2026-11-20.
 * NOT INEC-certified. These are historical reference records, never current results, and PollTrace
 * reviewers have not reviewed their provenance.
 */
export const NG2023_SOURCE = {
  id: "NIGERIA2_2023_CROSSCHECK",
  name: "Nigeria 2.0 independent crosscheck of 2023 presidential result sheets",
  url: "https://github.com/nigeria2/data-ng-election-2023",
  file: "2023_data/FCT_crosschecked.csv",
  fileSha256: "6734fc9b7747f88227c0a1bd932b4581fee15bba32dadf86551647e9c05ff431",
  retrievedAt: "2026-11-20",
  scope: "FCT · ABAJI LGA · crosschecked set (130 polling units)",
  licenceNote: "No licence file; README: open data provided as-is for transparency and research.",
} as const;

export const NG2023_ELECTION_ID = "ng-2023-presidential";
export const NG2023_PARTY_ROSTER = ["APC", "LP", "PDP", "NNPP"] as const;

export interface Ng2023Unit {
  id: string;
  code: string;
  name: string;
  ward: string;
  lga: string;
  state: string;
  figures: Record<(typeof NG2023_PARTY_ROSTER)[number], number>;
  accreditedVoters: number | null;
  registeredVoters: number | null;
  /** Result-sheet condition flags exactly as published (TRUE/FALSE/UNKNOWN). */
  sheet: { stamped: string; corrected: string; invalid: string; unclear: string; unsigned: string };
}

export const NG2023_UNITS: readonly Ng2023Unit[] = [
  {
    "id": "ng23-37-01-01-001",
    "code": "37-01-01-001",
    "name": "UNG. MAIKANO/KOFAR MAI UNGUWA I",
    "ward": "ABAJI CENTRAL",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 112,
      "LP": 12,
      "PDP": 65,
      "NNPP": 1
    },
    "accreditedVoters": 191,
    "registeredVoters": 750,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-01-002",
    "code": "37-01-01-002",
    "name": "UNG. MANKO/KOFAR UNGUWAR MANKO I",
    "ward": "ABAJI CENTRAL",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 216,
      "LP": 6,
      "PDP": 66,
      "NNPP": 3
    },
    "accreditedVoters": 296,
    "registeredVoters": 750,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-01-003",
    "code": "37-01-01-003",
    "name": "UNG. LIMAN/KOFAR UNGUWAR LIMAN I",
    "ward": "ABAJI CENTRAL",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 184,
      "LP": 10,
      "PDP": 70,
      "NNPP": 3
    },
    "accreditedVoters": 271,
    "registeredVoters": 750,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "TRUE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-02-001",
    "code": "37-01-02-001",
    "name": "ISAH M. GANI/OLD ONA PALACE I",
    "ward": "ABAJI NORTH EAST",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 148,
      "LP": 6,
      "PDP": 48,
      "NNPP": 0
    },
    "accreditedVoters": 212,
    "registeredVoters": 750,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-02-002",
    "code": "37-01-02-002",
    "name": "UNG. NUPAWA/MATERNITY CENTRE I",
    "ward": "ABAJI NORTH EAST",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 138,
      "LP": 11,
      "PDP": 103,
      "NNPP": 1
    },
    "accreditedVoters": 260,
    "registeredVoters": 750,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-02-003",
    "code": "37-01-02-003",
    "name": "UNG. ANYURA / GIDAN ANYURA I",
    "ward": "ABAJI NORTH EAST",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 84,
      "LP": 17,
      "PDP": 68,
      "NNPP": 0
    },
    "accreditedVoters": 190,
    "registeredVoters": 750,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "TRUE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-02-004",
    "code": "37-01-02-004",
    "name": "UNG. ANYURA / GIDAN ANYURA I",
    "ward": "ABAJI NORTH EAST",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 160,
      "LP": 28,
      "PDP": 33,
      "NNPP": 1
    },
    "accreditedVoters": 190,
    "registeredVoters": 750,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-02-005",
    "code": "37-01-02-005",
    "name": "UNG. MALLAM MANSUR I",
    "ward": "ABAJI NORTH EAST",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 247,
      "LP": 13,
      "PDP": 54,
      "NNPP": 3
    },
    "accreditedVoters": 323,
    "registeredVoters": 750,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-02-006",
    "code": "37-01-02-006",
    "name": "ABAJI NE / CENTRAL PRY. SCHOOL I",
    "ward": "ABAJI NORTH EAST",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 190,
      "LP": 113,
      "PDP": 75,
      "NNPP": 8
    },
    "accreditedVoters": 391,
    "registeredVoters": 1378,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-03-001",
    "code": "37-01-03-001",
    "name": "OLD ONAS PALACE  /  OLD ONAS PALACE I",
    "ward": "ABAJI SOUTH EAST",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 143,
      "LP": 15,
      "PDP": 45,
      "NNPP": 1
    },
    "accreditedVoters": 214,
    "registeredVoters": 750,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-03-002",
    "code": "37-01-03-002",
    "name": "OLD ONAS PALACE  /  OLD ONAS PALACE I",
    "ward": "ABAJI SOUTH EAST",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 112,
      "LP": 7,
      "PDP": 98,
      "NNPP": 2
    },
    "accreditedVoters": 214,
    "registeredVoters": 750,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-03-003",
    "code": "37-01-03-003",
    "name": "A.U SULEMAN  /  UNG.A.U. SULEMAN I",
    "ward": "ABAJI SOUTH EAST",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 116,
      "LP": 21,
      "PDP": 88,
      "NNPP": 4
    },
    "accreditedVoters": 248,
    "registeredVoters": 750,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-03-004",
    "code": "37-01-03-004",
    "name": "UNG. S.SAMARI/UNG. S. SAMARI I",
    "ward": "ABAJI SOUTH EAST",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 102,
      "LP": 8,
      "PDP": 67,
      "NNPP": 0
    },
    "accreditedVoters": 228,
    "registeredVoters": 750,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-04-001",
    "code": "37-01-04-001",
    "name": "AGYANA  /  AGYANA PRIMARY SCHOOL I",
    "ward": "AGYANA/PANDAGI",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 111,
      "LP": 18,
      "PDP": 92,
      "NNPP": 0
    },
    "accreditedVoters": 231,
    "registeredVoters": 750,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-04-002",
    "code": "37-01-04-002",
    "name": "AGYANA  /  AGYANA PRIMARY SCHOOL I",
    "ward": "AGYANA/PANDAGI",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 72,
      "LP": 100,
      "PDP": 105,
      "NNPP": 1
    },
    "accreditedVoters": 231,
    "registeredVoters": 750,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-04-003",
    "code": "37-01-04-003",
    "name": "NANDA / NANDA PRIMARY SCHOOL I",
    "ward": "AGYANA/PANDAGI",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 70,
      "LP": 79,
      "PDP": 126,
      "NNPP": 0
    },
    "accreditedVoters": 283,
    "registeredVoters": 750,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-04-004",
    "code": "37-01-04-004",
    "name": "KUNGUNI / KUNGUNI PRIMARY SCHOOL I",
    "ward": "AGYANA/PANDAGI",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 72,
      "LP": 47,
      "PDP": 136,
      "NNPP": 0
    },
    "accreditedVoters": 268,
    "registeredVoters": 750,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "TRUE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-05-001",
    "code": "37-01-05-001",
    "name": "EBAGI / EBAGI PRIMARY SCHOOL I",
    "ward": "RIMBA EBAGI",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 151,
      "LP": 0,
      "PDP": 103,
      "NNPP": 1
    },
    "accreditedVoters": 255,
    "registeredVoters": 750,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-05-002",
    "code": "37-01-05-002",
    "name": "RIMBA / RIMBA PRIMARY SCHOOL",
    "ward": "RIMBA EBAGI",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 54,
      "LP": 33,
      "PDP": 71,
      "NNPP": 0
    },
    "accreditedVoters": 158,
    "registeredVoters": 676,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-05-003",
    "code": "37-01-05-003",
    "name": "NAHARATI SABO/NAHARATI PRIMARY SCHOOL I",
    "ward": "RIMBA EBAGI",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 107,
      "LP": 3,
      "PDP": 80,
      "NNPP": 1
    },
    "accreditedVoters": 198,
    "registeredVoters": 750,
    "sheet": {
      "stamped": "TRUE",
      "corrected": "TRUE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-05-004",
    "code": "37-01-05-004",
    "name": "NAHARATI TSOHO/NHARATI TSOHO PRIMARY SCHOOL",
    "ward": "RIMBA EBAGI",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 209,
      "LP": 54,
      "PDP": 167,
      "NNPP": 1
    },
    "accreditedVoters": 436,
    "registeredVoters": 1318,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-05-005",
    "code": "37-01-05-005",
    "name": "TUPA/TUPA PRIMARY SCHOOL",
    "ward": "RIMBA EBAGI",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 103,
      "LP": 10,
      "PDP": 78,
      "NNPP": 0
    },
    "accreditedVoters": 211,
    "registeredVoters": 626,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "TRUE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-06-001",
    "code": "37-01-06-001",
    "name": "UNG. AKWAI ALLAH/GIDAN AKWAI ALLAH I",
    "ward": "NUKU",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 175,
      "LP": 29,
      "PDP": 43,
      "NNPP": 2
    },
    "accreditedVoters": 258,
    "registeredVoters": 750,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-06-002",
    "code": "37-01-06-002",
    "name": "NUKU/NUKU PRIMARY SCHOOL I",
    "ward": "NUKU",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 49,
      "LP": 67,
      "PDP": 122,
      "NNPP": 1
    },
    "accreditedVoters": 268,
    "registeredVoters": 750,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-06-006",
    "code": "37-01-06-006",
    "name": "NUKU / NUKU PRY. SCHOOL II",
    "ward": "NUKU",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 69,
      "LP": 46,
      "PDP": 137,
      "NNPP": 1
    },
    "accreditedVoters": 260,
    "registeredVoters": 750,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-06-003",
    "code": "37-01-06-003",
    "name": "ABAJI EAST/ABAJI EAST PRIMARY SCHOOL I",
    "ward": "NUKU",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 94,
      "LP": 69,
      "PDP": 31,
      "NNPP": 1
    },
    "accreditedVoters": 226,
    "registeredVoters": 750,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-06-005",
    "code": "37-01-06-005",
    "name": "KEKESHI/ KEKESHI VILLAGE",
    "ward": "NUKU",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 63,
      "LP": 64,
      "PDP": 85,
      "NNPP": 1
    },
    "accreditedVoters": 233,
    "registeredVoters": 750,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-07-001",
    "code": "37-01-07-001",
    "name": "MAMAGI/MAMAGI PRIMARY SCHOOL I",
    "ward": "ALU MAMAGI",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 59,
      "LP": 2,
      "PDP": 85,
      "NNPP": 0
    },
    "accreditedVoters": 147,
    "registeredVoters": 750,
    "sheet": {
      "stamped": "TRUE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-07-002",
    "code": "37-01-07-002",
    "name": "ALU/ALU PRIMARY SCHOOL I",
    "ward": "ALU MAMAGI",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 113,
      "LP": 2,
      "PDP": 128,
      "NNPP": 2
    },
    "accreditedVoters": 248,
    "registeredVoters": 750,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-07-003",
    "code": "37-01-07-003",
    "name": "MAMAGI/MAMAGI/  PRIMARY SCHOOL/MAWOGI",
    "ward": "ALU MAMAGI",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 79,
      "LP": 12,
      "PDP": 83,
      "NNPP": 4
    },
    "accreditedVoters": 179,
    "registeredVoters": 750,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "TRUE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-07-004",
    "code": "37-01-07-004",
    "name": "PACIWA/PACIWA/ PRIMARY SCHOOL",
    "ward": "ALU MAMAGI",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 160,
      "LP": 3,
      "PDP": 59,
      "NNPP": 0
    },
    "accreditedVoters": 226,
    "registeredVoters": 510,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-08-001",
    "code": "37-01-08-001",
    "name": "PACIWA/PACIWA/ PRIMARY SCHOOL",
    "ward": "ALU MAMAGI",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 69,
      "LP": 14,
      "PDP": 94,
      "NNPP": 0
    },
    "accreditedVoters": 226,
    "registeredVoters": 510,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-08-002",
    "code": "37-01-08-002",
    "name": "PACIWA/PACIWA/ PRIMARY SCHOOL",
    "ward": "ALU MAMAGI",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 28,
      "LP": 38,
      "PDP": 128,
      "NNPP": 0
    },
    "accreditedVoters": 226,
    "registeredVoters": 510,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-08-003",
    "code": "37-01-08-003",
    "name": "PACIWA/PACIWA/ PRIMARY SCHOOL",
    "ward": "ALU MAMAGI",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 27,
      "LP": 18,
      "PDP": 68,
      "NNPP": 0
    },
    "accreditedVoters": 226,
    "registeredVoters": 510,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-08-004",
    "code": "37-01-08-004",
    "name": "KPACE/KPACE PRIMARY SCHOOL",
    "ward": "YABA",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 128,
      "LP": 17,
      "PDP": 146,
      "NNPP": 0
    },
    "accreditedVoters": 299,
    "registeredVoters": 660,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-08-006",
    "code": "37-01-08-006",
    "name": "KULOHO/KULUHO PRIMARY SCHOOL",
    "ward": "YABA",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 45,
      "LP": 31,
      "PDP": 51,
      "NNPP": 0
    },
    "accreditedVoters": 133,
    "registeredVoters": 263,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-08-007",
    "code": "37-01-08-007",
    "name": "ADAGBA/ ADAGBA PRIMARY SCHOOL I",
    "ward": "YABA",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 139,
      "LP": 10,
      "PDP": 56,
      "NNPP": 0
    },
    "accreditedVoters": 207,
    "registeredVoters": 750,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-08-008",
    "code": "37-01-08-008",
    "name": "DURUMI/DURUMI PRIMARY VILLAGE SQUARE",
    "ward": "YABA",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 56,
      "LP": 9,
      "PDP": 33,
      "NNPP": 0
    },
    "accreditedVoters": 98,
    "registeredVoters": 221,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-09-001",
    "code": "37-01-09-001",
    "name": "GURDI/GURDI PRIMARY SCHOOL  I",
    "ward": "GURDI",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 69,
      "LP": 15,
      "PDP": 149,
      "NNPP": 1
    },
    "accreditedVoters": 236,
    "registeredVoters": 750,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-09-002",
    "code": "37-01-09-002",
    "name": "TEKPESHE  PRIMARY SCHOOL",
    "ward": "GURDI",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 107,
      "LP": 12,
      "PDP": 0,
      "NNPP": 2
    },
    "accreditedVoters": 123,
    "registeredVoters": 315,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-09-003",
    "code": "37-01-09-003",
    "name": "KUTAKARA/KUTAKARA PRIMARY SCHOOL",
    "ward": "GURDI",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 154,
      "LP": 0,
      "PDP": 16,
      "NNPP": 0
    },
    "accreditedVoters": 170,
    "registeredVoters": 608,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-09-004",
    "code": "37-01-09-004",
    "name": "GULIDA/GULIDA  PRIMARY SCHOOL",
    "ward": "GURDI",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 96,
      "LP": 0,
      "PDP": 27,
      "NNPP": 0
    },
    "accreditedVoters": 123,
    "registeredVoters": 375,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-09-005",
    "code": "37-01-09-005",
    "name": "GULIDA/GULIDA  PRIMARY SCHOOL",
    "ward": "GURDI",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 13,
      "LP": 1,
      "PDP": 10,
      "NNPP": 0
    },
    "accreditedVoters": 123,
    "registeredVoters": 375,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-09-006",
    "code": "37-01-09-006",
    "name": "KWAKWA/KWAKWA  PRIMARY SCHOOL",
    "ward": "GURDI",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 32,
      "LP": 0,
      "PDP": 38,
      "NNPP": 0
    },
    "accreditedVoters": 70,
    "registeredVoters": 383,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-09-007",
    "code": "37-01-09-007",
    "name": "BARABARI/BARABARI  PRIMARY SCHOOL",
    "ward": "GURDI",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 30,
      "LP": 3,
      "PDP": 13,
      "NNPP": 0
    },
    "accreditedVoters": 48,
    "registeredVoters": 275,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-09-008",
    "code": "37-01-09-008",
    "name": "CHAKUMI/CHAKUMI VILLAGE SQUARE",
    "ward": "GURDI",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 27,
      "LP": 0,
      "PDP": 16,
      "NNPP": 0
    },
    "accreditedVoters": 45,
    "registeredVoters": 405,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "TRUE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-09-009",
    "code": "37-01-09-009",
    "name": "CHAKUMI/CHAKUMI VILLAGE SQUARE",
    "ward": "GURDI",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 26,
      "LP": 0,
      "PDP": 17,
      "NNPP": 0
    },
    "accreditedVoters": 45,
    "registeredVoters": 405,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-10-001",
    "code": "37-01-10-001",
    "name": "CHAKUMI/CHAKUMI VILLAGE SQUARE",
    "ward": "GURDI",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 85,
      "LP": 32,
      "PDP": 33,
      "NNPP": 0
    },
    "accreditedVoters": 45,
    "registeredVoters": 405,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "TRUE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-10-002",
    "code": "37-01-10-002",
    "name": "YELWAN GAWU/YELWAN GAWU PRIMARY SCHOOL I",
    "ward": "GAWU",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 127,
      "LP": 4,
      "PDP": 28,
      "NNPP": 0
    },
    "accreditedVoters": 182,
    "registeredVoters": 750,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-10-003",
    "code": "37-01-10-003",
    "name": "JAMIGBE/JAMIGBE/JAMIGBE PRIMARY SCHOOL I",
    "ward": "GAWU",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 65,
      "LP": 11,
      "PDP": 74,
      "NNPP": 0
    },
    "accreditedVoters": 152,
    "registeredVoters": 750,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-10-004",
    "code": "37-01-10-004",
    "name": "MAWOGI/MAWOGI PRIMARY SCHOOL I",
    "ward": "GAWU",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 107,
      "LP": 5,
      "PDP": 18,
      "NNPP": 0
    },
    "accreditedVoters": 131,
    "registeredVoters": 750,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-10-005",
    "code": "37-01-10-005",
    "name": "SABONGURARA/GURARA PRIMARY SCHOOL I",
    "ward": "GAWU",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 52,
      "LP": 79,
      "PDP": 23,
      "NNPP": 1
    },
    "accreditedVoters": 170,
    "registeredVoters": 750,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-10-006",
    "code": "37-01-10-006",
    "name": "TUNGAN USMAN/TUNGAN USMAN PRIMARY SCHOOL",
    "ward": "GAWU",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 51,
      "LP": 94,
      "PDP": 15,
      "NNPP": 0
    },
    "accreditedVoters": 167,
    "registeredVoters": 750,
    "sheet": {
      "stamped": "TRUE",
      "corrected": "TRUE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-02-013",
    "code": "37-01-02-013",
    "name": "SABO TASHA NEW DEVELOPMENT AREA",
    "ward": "ABAJI NORTH EAST",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 119,
      "LP": 33,
      "PDP": 80,
      "NNPP": 1
    },
    "accreditedVoters": 249,
    "registeredVoters": 536,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-02-014",
    "code": "37-01-02-014",
    "name": "ROAD SAFET QTRS",
    "ward": "ABAJI NORTH EAST",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 62,
      "LP": 42,
      "PDP": 24,
      "NNPP": 1
    },
    "accreditedVoters": 138,
    "registeredVoters": 379,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-04-008",
    "code": "37-01-04-008",
    "name": "FCT UNIVERSITY OF TECHNOLOGY",
    "ward": "AGYANA/PANDAGI",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 40,
      "LP": 7,
      "PDP": 34,
      "NNPP": 0
    },
    "accreditedVoters": 87,
    "registeredVoters": 268,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-06-015",
    "code": "37-01-06-015",
    "name": "SABO GARI  PHASE III NEW EXTENTION",
    "ward": "NUKU",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 35,
      "LP": 70,
      "PDP": 51,
      "NNPP": 0
    },
    "accreditedVoters": 169,
    "registeredVoters": 477,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-06-016",
    "code": "37-01-06-016",
    "name": "LOW COST",
    "ward": "NUKU",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 61,
      "LP": 44,
      "PDP": 11,
      "NNPP": 1
    },
    "accreditedVoters": 131,
    "registeredVoters": 405,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-07-006",
    "code": "37-01-07-006",
    "name": "CHAPU AGULO PRIMARY SCHOOL",
    "ward": "ALU MAMAGI",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 0,
      "LP": 0,
      "PDP": 0,
      "NNPP": 0
    },
    "accreditedVoters": 145,
    "registeredVoters": 359,
    "sheet": {
      "stamped": "TRUE",
      "corrected": "FALSE",
      "invalid": "TRUE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-10-011",
    "code": "37-01-10-011",
    "name": "GBASAKPA I AND II PRIMARY SCHOOL",
    "ward": "GAWU",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 34,
      "LP": 1,
      "PDP": 12,
      "NNPP": 0
    },
    "accreditedVoters": 47,
    "registeredVoters": 188,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-10-016",
    "code": "37-01-10-016",
    "name": "JAMIGBE/PELERE PRIMARY SCHOOL",
    "ward": "GAWU",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 140,
      "LP": 8,
      "PDP": 62,
      "NNPP": 0
    },
    "accreditedVoters": 225,
    "registeredVoters": 536,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-10-021",
    "code": "37-01-10-021",
    "name": "UNGWAN TIV",
    "ward": "GAWU",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 0,
      "LP": 2,
      "PDP": 3,
      "NNPP": 0
    },
    "accreditedVoters": 5,
    "registeredVoters": 18,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-10-022",
    "code": "37-01-10-022",
    "name": "TUNGWAN USMAN PRIMARY SCHOOL",
    "ward": "GAWU",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 19,
      "LP": 30,
      "PDP": 15,
      "NNPP": 0
    },
    "accreditedVoters": 78,
    "registeredVoters": 363,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-10-020",
    "code": "37-01-10-020",
    "name": "SABON GURARA/GURARA PRIMARY SCHOOL III",
    "ward": "GAWU",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 55,
      "LP": 21,
      "PDP": 63,
      "NNPP": 1
    },
    "accreditedVoters": 144,
    "registeredVoters": 680,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-10-019",
    "code": "37-01-10-019",
    "name": "SABON GURARA/GURARA PRIMARY SCHOOL II",
    "ward": "GAWU",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 73,
      "LP": 49,
      "PDP": 30,
      "NNPP": 1
    },
    "accreditedVoters": 159,
    "registeredVoters": 678,
    "sheet": {
      "stamped": "TRUE",
      "corrected": "TRUE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-10-018",
    "code": "37-01-10-018",
    "name": "MAWOGI /MAWOGI PRIMARY SCHOOL III",
    "ward": "GAWU",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 51,
      "LP": 0,
      "PDP": 64,
      "NNPP": 0
    },
    "accreditedVoters": 65,
    "registeredVoters": 284,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "TRUE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-10-017",
    "code": "37-01-10-017",
    "name": "MAWOGI /MAWOGI PRIMARY SCHOOL II",
    "ward": "GAWU",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 55,
      "LP": 0,
      "PDP": 10,
      "NNPP": 0
    },
    "accreditedVoters": 68,
    "registeredVoters": 285,
    "sheet": {
      "stamped": "TRUE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-10-015",
    "code": "37-01-10-015",
    "name": "JAMIGBE/GIGBE PRIMARY SCHOOL",
    "ward": "GAWU",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 62,
      "LP": 2,
      "PDP": 28,
      "NNPP": 0
    },
    "accreditedVoters": 100,
    "registeredVoters": 240,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-10-014",
    "code": "37-01-10-014",
    "name": "JAMIGBE/JAMIGBE PRIMARY SCHOOL",
    "ward": "GAWU",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 17,
      "LP": 1,
      "PDP": 15,
      "NNPP": 0
    },
    "accreditedVoters": 34,
    "registeredVoters": 125,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-10-013",
    "code": "37-01-10-013",
    "name": "YELWAN GAWU PRIMARY SCHOOL III",
    "ward": "GAWU",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 60,
      "LP": 0,
      "PDP": 18,
      "NNPP": 0
    },
    "accreditedVoters": 82,
    "registeredVoters": 271,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-10-012",
    "code": "37-01-10-012",
    "name": "YELWAN GAWU PRIMARY SCHOOL II",
    "ward": "GAWU",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 79,
      "LP": 0,
      "PDP": 9,
      "NNPP": 0
    },
    "accreditedVoters": 88,
    "registeredVoters": 273,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "TRUE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-10-010",
    "code": "37-01-10-010",
    "name": "GAWU TOWN/GAWU PRIMARY SCHOOL V",
    "ward": "GAWU",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 64,
      "LP": 8,
      "PDP": 17,
      "NNPP": 1
    },
    "accreditedVoters": 100,
    "registeredVoters": 441,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "TRUE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-10-009",
    "code": "37-01-10-009",
    "name": "GAWU TOWN/GAWU PRIMARY SCHOOL V",
    "ward": "GAWU",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 50,
      "LP": 8,
      "PDP": 33,
      "NNPP": 0
    },
    "accreditedVoters": 100,
    "registeredVoters": 441,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-10-008",
    "code": "37-01-10-008",
    "name": "GAWU TOWN PRIMARY SCHOOL III",
    "ward": "GAWU",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 46,
      "LP": 8,
      "PDP": 33,
      "NNPP": 1
    },
    "accreditedVoters": 95,
    "registeredVoters": 415,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-10-007",
    "code": "37-01-10-007",
    "name": "GAWU TOWN PRIMARY SCHOOL II",
    "ward": "GAWU",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 48,
      "LP": 10,
      "PDP": 30,
      "NNPP": 0
    },
    "accreditedVoters": 89,
    "registeredVoters": 418,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-09-012",
    "code": "37-01-09-012",
    "name": "RAFIN DAJI PRIMARY SCHOOL",
    "ward": "GURDI",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 180,
      "LP": 2,
      "PDP": 52,
      "NNPP": 0
    },
    "accreditedVoters": 234,
    "registeredVoters": 356,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-09-011",
    "code": "37-01-09-011",
    "name": "UNGWAN YUNUSA",
    "ward": "GURDI",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 22,
      "LP": 55,
      "PDP": 12,
      "NNPP": 1
    },
    "accreditedVoters": 90,
    "registeredVoters": 198,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-09-010",
    "code": "37-01-09-010",
    "name": "GURDI/ GURDI PRIMARY SCHOOL II",
    "ward": "GURDI",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 5,
      "LP": 2,
      "PDP": 10,
      "NNPP": 0
    },
    "accreditedVoters": 18,
    "registeredVoters": 52,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-08-012",
    "code": "37-01-08-012",
    "name": "ADAGBA/ADAGBA PRIMARY SCHOOL II",
    "ward": "YABA",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 35,
      "LP": 0,
      "PDP": 14,
      "NNPP": 0
    },
    "accreditedVoters": 49,
    "registeredVoters": 131,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "TRUE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-08-011",
    "code": "37-01-08-011",
    "name": "YABA TOWN/YABA PRIMARY SCHOOL IV",
    "ward": "YABA",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 49,
      "LP": 17,
      "PDP": 54,
      "NNPP": 0
    },
    "accreditedVoters": 132,
    "registeredVoters": 455,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-08-010",
    "code": "37-01-08-010",
    "name": "YABA TOWN/YABA PRIMARY SCHOOL III",
    "ward": "YABA",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 56,
      "LP": 11,
      "PDP": 62,
      "NNPP": 0
    },
    "accreditedVoters": 134,
    "registeredVoters": 459,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-08-009",
    "code": "37-01-08-009",
    "name": "YABA TOWN/ YABA PRIMARY SCHOOL II",
    "ward": "YABA",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 51,
      "LP": 23,
      "PDP": 72,
      "NNPP": 0
    },
    "accreditedVoters": 152,
    "registeredVoters": 453,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-07-008",
    "code": "37-01-07-008",
    "name": "MAWOGI PRIMARY SCHOOL",
    "ward": "ALU MAMAGI",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 24,
      "LP": 7,
      "PDP": 42,
      "NNPP": 3
    },
    "accreditedVoters": 77,
    "registeredVoters": 360,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-07-007",
    "code": "37-01-07-007",
    "name": "ALU PRIMARY SCHOOL II",
    "ward": "ALU MAMAGI",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 6,
      "LP": 0,
      "PDP": 2,
      "NNPP": 0
    },
    "accreditedVoters": 8,
    "registeredVoters": 15,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-07-005",
    "code": "37-01-07-005",
    "name": "MAMAGI/MAMAGI  PRIMARY SCHOOL II",
    "ward": "ALU MAMAGI",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 41,
      "LP": 1,
      "PDP": 57,
      "NNPP": 0
    },
    "accreditedVoters": 101,
    "registeredVoters": 247,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-06-020",
    "code": "37-01-06-020",
    "name": "NUKU/NUKU PRIMARY SCHOOL IV",
    "ward": "NUKU",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 36,
      "LP": 37,
      "PDP": 96,
      "NNPP": 3
    },
    "accreditedVoters": 179,
    "registeredVoters": 463,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-06-019",
    "code": "37-01-06-019",
    "name": "KEKESHI VILLAGE SQUARE II",
    "ward": "NUKU",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 60,
      "LP": 41,
      "PDP": 64,
      "NNPP": 1
    },
    "accreditedVoters": 178,
    "registeredVoters": 519,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-06-018",
    "code": "37-01-06-018",
    "name": "KEKESHI VILLAGE SQUARE I",
    "ward": "NUKU",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 54,
      "LP": 56,
      "PDP": 68,
      "NNPP": 0
    },
    "accreditedVoters": 199,
    "registeredVoters": 546,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-06-017",
    "code": "37-01-06-017",
    "name": "MADEREGI /MADEREGI PRIMARY SCHOOL II",
    "ward": "NUKU",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 22,
      "LP": 5,
      "PDP": 39,
      "NNPP": 0
    },
    "accreditedVoters": 66,
    "registeredVoters": 160,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-06-014",
    "code": "37-01-06-014",
    "name": "ABAJI EAST/ABAJI EAST PRIMARY SCHOOL VI",
    "ward": "NUKU",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 68,
      "LP": 38,
      "PDP": 23,
      "NNPP": 3
    },
    "accreditedVoters": 181,
    "registeredVoters": 449,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-06-013",
    "code": "37-01-06-013",
    "name": "ABAJI EAST/ABAJI EAST PRIMARY SCHOOL V",
    "ward": "NUKU",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 60,
      "LP": 52,
      "PDP": 24,
      "NNPP": 2
    },
    "accreditedVoters": 166,
    "registeredVoters": 436,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-06-012",
    "code": "37-01-06-012",
    "name": "ABAJI EAST/ABAJI EAST PRIMARY SCHOOL IV",
    "ward": "NUKU",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 36,
      "LP": 46,
      "PDP": 21,
      "NNPP": 0
    },
    "accreditedVoters": 129,
    "registeredVoters": 368,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-06-011",
    "code": "37-01-06-011",
    "name": "ABAJI EAST/ABAJI EAST PRIMARY SCHOOL III",
    "ward": "NUKU",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 53,
      "LP": 35,
      "PDP": 26,
      "NNPP": 0
    },
    "accreditedVoters": 120,
    "registeredVoters": 343,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-06-010",
    "code": "37-01-06-010",
    "name": "ABAJI EAST/ABAJI EAST PRIMARY SCHOOL II",
    "ward": "NUKU",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 53,
      "LP": 23,
      "PDP": 25,
      "NNPP": 0
    },
    "accreditedVoters": 105,
    "registeredVoters": 332,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-06-009",
    "code": "37-01-06-009",
    "name": "NUKU/NUKU PRIMARY SCHOOL III",
    "ward": "NUKU",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 22,
      "LP": 33,
      "PDP": 57,
      "NNPP": 0
    },
    "accreditedVoters": 117,
    "registeredVoters": 252,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-06-008",
    "code": "37-01-06-008",
    "name": "UNG AKWAI ALLAH GIDAN AKWAI ALLAH III",
    "ward": "NUKU",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 124,
      "LP": 16,
      "PDP": 46,
      "NNPP": 0
    },
    "accreditedVoters": 207,
    "registeredVoters": 565,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-06-007",
    "code": "37-01-06-007",
    "name": "UNG AKWAI ALLAH GIDAN AKWAI ALLAH II",
    "ward": "NUKU",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 132,
      "LP": 30,
      "PDP": 45,
      "NNPP": 2
    },
    "accreditedVoters": 211,
    "registeredVoters": 533,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-05-011",
    "code": "37-01-05-011",
    "name": "NAHARATI SABO/NAHARATI PRIMARY SCHOOL V",
    "ward": "RIMBA EBAGI",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 60,
      "LP": 3,
      "PDP": 40,
      "NNPP": 0
    },
    "accreditedVoters": 110,
    "registeredVoters": 327,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-05-010",
    "code": "37-01-05-010",
    "name": "NAHARATI SABO/NAHARATI PRIMARY SCHOOL IV",
    "ward": "RIMBA EBAGI",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 53,
      "LP": 3,
      "PDP": 40,
      "NNPP": 0
    },
    "accreditedVoters": 106,
    "registeredVoters": 314,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-05-009",
    "code": "37-01-05-009",
    "name": "NAHARATI SABO/ NAHARATI PRIMARY SCHOOL III",
    "ward": "RIMBA EBAGI",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 36,
      "LP": 3,
      "PDP": 52,
      "NNPP": 0
    },
    "accreditedVoters": 96,
    "registeredVoters": 330,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-05-008",
    "code": "37-01-05-008",
    "name": "NAHARATI SABO/ NAHARATI PRIMARY SCHOOL II",
    "ward": "RIMBA EBAGI",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 59,
      "LP": 7,
      "PDP": 55,
      "NNPP": 0
    },
    "accreditedVoters": 127,
    "registeredVoters": 325,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-05-007",
    "code": "37-01-05-007",
    "name": "EBAGI/EBAGI PRIMARY SCHOOL II",
    "ward": "RIMBA EBAGI",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 87,
      "LP": 0,
      "PDP": 74,
      "NNPP": 0
    },
    "accreditedVoters": 161,
    "registeredVoters": 445,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-04-011",
    "code": "37-01-04-011",
    "name": "KUNGUNI/KUNGUNI PRIMARY II",
    "ward": "AGYANA/PANDAGI",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 15,
      "LP": 9,
      "PDP": 12,
      "NNPP": 0
    },
    "accreditedVoters": 37,
    "registeredVoters": 99,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-04-010",
    "code": "37-01-04-010",
    "name": "NANDA/NANDA PRIMARY SCHOOL II",
    "ward": "AGYANA/PANDAGI",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 27,
      "LP": 71,
      "PDP": 49,
      "NNPP": 1
    },
    "accreditedVoters": 149,
    "registeredVoters": 300,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "TRUE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-04-009",
    "code": "37-01-04-009",
    "name": "PANDAGI/ PANDAGI PRIMARY SCHOOL II",
    "ward": "AGYANA/PANDAGI",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 0,
      "LP": 0,
      "PDP": 0,
      "NNPP": 0
    },
    "accreditedVoters": 226,
    "registeredVoters": 456,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-04-006",
    "code": "37-01-04-006",
    "name": "ANGYANA/AGYANA PRIAMRY SCHOOL III",
    "ward": "AGYANA/PANDAGI",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 56,
      "LP": 22,
      "PDP": 72,
      "NNPP": 0
    },
    "accreditedVoters": 159,
    "registeredVoters": 328,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-04-005",
    "code": "37-01-04-005",
    "name": "ANGYANA/AGYANA PRIAMRY SCHOOL II",
    "ward": "AGYANA/PANDAGI",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 56,
      "LP": 27,
      "PDP": 49,
      "NNPP": 0
    },
    "accreditedVoters": 143,
    "registeredVoters": 343,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-03-010",
    "code": "37-01-03-010",
    "name": "UNG. S. SAMARI/UNG S. SAMARI III",
    "ward": "ABAJI SOUTH EAST",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 73,
      "LP": 6,
      "PDP": 38,
      "NNPP": 0
    },
    "accreditedVoters": 124,
    "registeredVoters": 337,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-03-009",
    "code": "37-01-03-009",
    "name": "UNG. S. SAMARI/UNG S. SAMARI II",
    "ward": "ABAJI SOUTH EAST",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 62,
      "LP": 2,
      "PDP": 45,
      "NNPP": 0
    },
    "accreditedVoters": 122,
    "registeredVoters": 324,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-03-008",
    "code": "37-01-03-008",
    "name": "A.U SULEIMAN /UNG.A.U SULEIMAN III",
    "ward": "ABAJI SOUTH EAST",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 81,
      "LP": 26,
      "PDP": 43,
      "NNPP": 4
    },
    "accreditedVoters": 175,
    "registeredVoters": 451,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-03-007",
    "code": "37-01-03-007",
    "name": "A.U SULEIMAN /UNG.A.U SULEIMAN II",
    "ward": "ABAJI SOUTH EAST",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 70,
      "LP": 11,
      "PDP": 60,
      "NNPP": 2
    },
    "accreditedVoters": 153,
    "registeredVoters": 437,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-03-006",
    "code": "37-01-03-006",
    "name": "UNGWAN NDAMAZARI / GIDAN NDAMAZARI",
    "ward": "ABAJI SOUTH EAST",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 112,
      "LP": 3,
      "PDP": 68,
      "NNPP": 1
    },
    "accreditedVoters": 194,
    "registeredVoters": 464,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-03-005",
    "code": "37-01-03-005",
    "name": "UNGWAN NDAMAZARI / GIDAN NDAMAZARI",
    "ward": "ABAJI SOUTH EAST",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 117,
      "LP": 8,
      "PDP": 34,
      "NNPP": 5
    },
    "accreditedVoters": 194,
    "registeredVoters": 464,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-02-019",
    "code": "37-01-02-019",
    "name": "ABAJI NORTH EAST PRY SCHOOL III",
    "ward": "ABAJI NORTH EAST",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 15,
      "LP": 31,
      "PDP": 7,
      "NNPP": 0
    },
    "accreditedVoters": 55,
    "registeredVoters": 111,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-02-018",
    "code": "37-01-02-018",
    "name": "ABAJI NORTH EAST PRY SCHOOL II",
    "ward": "ABAJI NORTH EAST",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 102,
      "LP": 77,
      "PDP": 44,
      "NNPP": 2
    },
    "accreditedVoters": 238,
    "registeredVoters": 750,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-02-017",
    "code": "37-01-02-017",
    "name": "UNG.MALLAM MANSUR II",
    "ward": "ABAJI NORTH EAST",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 126,
      "LP": 5,
      "PDP": 58,
      "NNPP": 0
    },
    "accreditedVoters": 193,
    "registeredVoters": 403,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-02-016",
    "code": "37-01-02-016",
    "name": "UNG.HUSSAINI WANZAMI III",
    "ward": "ABAJI NORTH EAST",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 116,
      "LP": 25,
      "PDP": 24,
      "NNPP": 1
    },
    "accreditedVoters": 176,
    "registeredVoters": 507,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-02-015",
    "code": "37-01-02-015",
    "name": "UNG.HUSSAINI WANZAMI II",
    "ward": "ABAJI NORTH EAST",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 121,
      "LP": 23,
      "PDP": 23,
      "NNPP": 1
    },
    "accreditedVoters": 168,
    "registeredVoters": 496,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-02-012",
    "code": "37-01-02-012",
    "name": "UNG. ANYURA/GIDAN ANYURA IV",
    "ward": "ABAJI NORTH EAST",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 42,
      "LP": 44,
      "PDP": 20,
      "NNPP": 1
    },
    "accreditedVoters": 119,
    "registeredVoters": 357,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-02-011",
    "code": "37-01-02-011",
    "name": "UNG. ANYURA/GIDAN ANYURA III",
    "ward": "ABAJI NORTH EAST",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 69,
      "LP": 15,
      "PDP": 25,
      "NNPP": 1
    },
    "accreditedVoters": 113,
    "registeredVoters": 336,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-02-010",
    "code": "37-01-02-010",
    "name": "UNG. ANYURA/GIDAN ANYURA II",
    "ward": "ABAJI NORTH EAST",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 69,
      "LP": 19,
      "PDP": 20,
      "NNPP": 1
    },
    "accreditedVoters": 118,
    "registeredVoters": 318,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-02-009",
    "code": "37-01-02-009",
    "name": "UNG. NUPAWA MATERNITY CENTRE III",
    "ward": "ABAJI NORTH EAST",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 141,
      "LP": 4,
      "PDP": 83,
      "NNPP": 0
    },
    "accreditedVoters": 231,
    "registeredVoters": 604,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-02-008",
    "code": "37-01-02-008",
    "name": "UNG. NUPAWA MATERNITY CENTRE II",
    "ward": "ABAJI NORTH EAST",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 8,
      "LP": 0,
      "PDP": 3,
      "NNPP": 0
    },
    "accreditedVoters": 12,
    "registeredVoters": 17,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-02-007",
    "code": "37-01-02-007",
    "name": "ISAH M.GANI/OLD ONA'S PALACE II",
    "ward": "ABAJI NORTH EAST",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 72,
      "LP": 7,
      "PDP": 31,
      "NNPP": 2
    },
    "accreditedVoters": 130,
    "registeredVoters": 389,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-01-009",
    "code": "37-01-01-009",
    "name": "UNG.LIMAN/KOFAR UNG. LIMAN II",
    "ward": "ABAJI CENTRAL",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 51,
      "LP": 1,
      "PDP": 20,
      "NNPP": 0
    },
    "accreditedVoters": 80,
    "registeredVoters": 139,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-01-008",
    "code": "37-01-01-008",
    "name": "UNG. MANKO/KOFAR UNG. MANKO III",
    "ward": "ABAJI CENTRAL",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 104,
      "LP": 2,
      "PDP": 39,
      "NNPP": 0
    },
    "accreditedVoters": 146,
    "registeredVoters": 372,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-01-007",
    "code": "37-01-01-007",
    "name": "UNG. MANKO/KOFAR UNG. MANKO II",
    "ward": "ABAJI CENTRAL",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 54,
      "LP": 33,
      "PDP": 62,
      "NNPP": 3
    },
    "accreditedVoters": 145,
    "registeredVoters": 350,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-01-006",
    "code": "37-01-01-006",
    "name": "UNG. MAIKANO/KOFAR MAI UNGWA IV",
    "ward": "ABAJI CENTRAL",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 85,
      "LP": 19,
      "PDP": 18,
      "NNPP": 0
    },
    "accreditedVoters": 130,
    "registeredVoters": 507,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-01-005",
    "code": "37-01-01-005",
    "name": "UNG. MAIKANO/KOFAR MAI UNGWA III",
    "ward": "ABAJI CENTRAL",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 93,
      "LP": 3,
      "PDP": 56,
      "NNPP": 3
    },
    "accreditedVoters": 162,
    "registeredVoters": 514,
    "sheet": {
      "stamped": "TRUE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  },
  {
    "id": "ng23-37-01-01-004",
    "code": "37-01-01-004",
    "name": "UNG. MAIKANO/KOFAR MAI UNGWA Ii",
    "ward": "ABAJI CENTRAL",
    "lga": "ABAJI",
    "state": "FCT",
    "figures": {
      "APC": 86,
      "LP": 5,
      "PDP": 46,
      "NNPP": 1
    },
    "accreditedVoters": 152,
    "registeredVoters": 478,
    "sheet": {
      "stamped": "FALSE",
      "corrected": "FALSE",
      "invalid": "FALSE",
      "unclear": "FALSE",
      "unsigned": "UNKNOWN"
    }
  }
];
