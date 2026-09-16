/** Kenney Furniture Kit (CC0) + Claw3D aliases + a few procedural office extras. */
export type CatalogEntry = { glb: string | null; footprint: number[]; procedural?: boolean };

export const FURNITURE_CATALOG: Record<string, CatalogEntry> = {
  "bathroom_cabinet": {
    "glb": "bathroomCabinet.glb",
    "footprint": [
      13,
      8
    ]
  },
  "bathroom_cabinet_drawer": {
    "glb": "bathroomCabinetDrawer.glb",
    "footprint": [
      24,
      18
    ]
  },
  "bathroom_mirror": {
    "glb": "bathroomMirror.glb",
    "footprint": [
      17,
      8
    ]
  },
  "bathroom_sink": {
    "glb": "bathroomSink.glb",
    "footprint": [
      19,
      16
    ]
  },
  "bathroom_sink_square": {
    "glb": "bathroomSinkSquare.glb",
    "footprint": [
      24,
      17
    ]
  },
  "bathtub": {
    "glb": "bathtub.glb",
    "footprint": [
      66,
      31
    ]
  },
  "bear": {
    "glb": "bear.glb",
    "footprint": [
      22,
      14
    ]
  },
  "bed_bunk": {
    "glb": "bedBunk.glb",
    "footprint": [
      32,
      61
    ]
  },
  "bed_double": {
    "glb": "bedDouble.glb",
    "footprint": [
      53,
      63
    ]
  },
  "bed_single": {
    "glb": "bedSingle.glb",
    "footprint": [
      32,
      63
    ]
  },
  "bench": {
    "glb": "bench.glb",
    "footprint": [
      22,
      11
    ]
  },
  "bench_cushion": {
    "glb": "benchCushion.glb",
    "footprint": [
      22,
      11
    ]
  },
  "bench_cushion_low": {
    "glb": "benchCushionLow.glb",
    "footprint": [
      23,
      12
    ]
  },
  "bookcase_closed": {
    "glb": "bookcaseClosed.glb",
    "footprint": [
      22,
      14
    ]
  },
  "bookcase_closed_doors": {
    "glb": "bookcaseClosedDoors.glb",
    "footprint": [
      22,
      14
    ]
  },
  "bookcase_closed_wide": {
    "glb": "bookcaseClosedWide.glb",
    "footprint": [
      44,
      14
    ]
  },
  "bookcase_open": {
    "glb": "bookcaseOpen.glb",
    "footprint": [
      22,
      14
    ]
  },
  "bookcase_open_low": {
    "glb": "bookcaseOpenLow.glb",
    "footprint": [
      22,
      14
    ]
  },
  "books": {
    "glb": "books.glb",
    "footprint": [
      8,
      8
    ]
  },
  "cabinet_bed": {
    "glb": "cabinetBed.glb",
    "footprint": [
      15,
      12
    ]
  },
  "cabinet_bed_drawer": {
    "glb": "cabinetBedDrawer.glb",
    "footprint": [
      15,
      12
    ]
  },
  "cabinet_bed_drawer_table": {
    "glb": "cabinetBedDrawerTable.glb",
    "footprint": [
      15,
      12
    ]
  },
  "cabinet_television": {
    "glb": "cabinetTelevision.glb",
    "footprint": [
      44,
      14
    ]
  },
  "cabinet_television_doors": {
    "glb": "cabinetTelevisionDoors.glb",
    "footprint": [
      44,
      14
    ]
  },
  "cardboard_box_closed": {
    "glb": "cardboardBoxClosed.glb",
    "footprint": [
      12,
      12
    ]
  },
  "cardboard_box_open": {
    "glb": "cardboardBoxOpen.glb",
    "footprint": [
      21,
      12
    ]
  },
  "ceiling_fan": {
    "glb": "ceilingFan.glb",
    "footprint": [
      25,
      29
    ]
  },
  "chair": {
    "glb": "chairDesk.glb",
    "footprint": [
      24,
      24
    ]
  },
  "chair_cushion": {
    "glb": "chairCushion.glb",
    "footprint": [
      11,
      11
    ]
  },
  "chair_desk": {
    "glb": "chairDesk.glb",
    "footprint": [
      19,
      17
    ]
  },
  "chair_modern_cushion": {
    "glb": "chairModernCushion.glb",
    "footprint": [
      11,
      11
    ]
  },
  "chair_modern_frame_cushion": {
    "glb": "chairModernFrameCushion.glb",
    "footprint": [
      11,
      11
    ]
  },
  "chair_rounded": {
    "glb": "chairRounded.glb",
    "footprint": [
      11,
      11
    ]
  },
  "coat_rack": {
    "glb": "coatRack.glb",
    "footprint": [
      25,
      8
    ]
  },
  "coat_rack_standing": {
    "glb": "coatRackStanding.glb",
    "footprint": [
      15,
      15
    ]
  },
  "computer_keyboard": {
    "glb": "computerKeyboard.glb",
    "footprint": [
      16,
      8
    ]
  },
  "computer_mouse": {
    "glb": "computerMouse.glb",
    "footprint": [
      8,
      8
    ]
  },
  "computer_screen": {
    "glb": "computerScreen.glb",
    "footprint": [
      22,
      8
    ]
  },
  "desk": {
    "glb": "desk.glb",
    "footprint": [
      41,
      22
    ]
  },
  "desk_corner": {
    "glb": "deskCorner.glb",
    "footprint": [
      54,
      54
    ]
  },
  "dryer": {
    "glb": "dryer.glb",
    "footprint": [
      22,
      21
    ]
  },
  "hood_large": {
    "glb": "hoodLarge.glb",
    "footprint": [
      24,
      16
    ]
  },
  "hood_modern": {
    "glb": "hoodModern.glb",
    "footprint": [
      24,
      16
    ]
  },
  "kitchen_bar": {
    "glb": "kitchenBar.glb",
    "footprint": [
      24,
      12
    ]
  },
  "kitchen_bar_end": {
    "glb": "kitchenBarEnd.glb",
    "footprint": [
      8,
      12
    ]
  },
  "kitchen_blender": {
    "glb": "kitchenBlender.glb",
    "footprint": [
      8,
      8
    ]
  },
  "kitchen_cabinet": {
    "glb": "kitchenCabinet.glb",
    "footprint": [
      24,
      25
    ]
  },
  "kitchen_cabinet_corner_inner": {
    "glb": "kitchenCabinetCornerInner.glb",
    "footprint": [
      26,
      26
    ]
  },
  "kitchen_cabinet_corner_round": {
    "glb": "kitchenCabinetCornerRound.glb",
    "footprint": [
      25,
      25
    ]
  },
  "kitchen_cabinet_drawer": {
    "glb": "kitchenCabinetDrawer.glb",
    "footprint": [
      24,
      25
    ]
  },
  "kitchen_cabinet_upper": {
    "glb": "kitchenCabinetUpper.glb",
    "footprint": [
      24,
      12
    ]
  },
  "kitchen_cabinet_upper_corner": {
    "glb": "kitchenCabinetUpperCorner.glb",
    "footprint": [
      12,
      12
    ]
  },
  "kitchen_cabinet_upper_double": {
    "glb": "kitchenCabinetUpperDouble.glb",
    "footprint": [
      24,
      12
    ]
  },
  "kitchen_cabinet_upper_low": {
    "glb": "kitchenCabinetUpperLow.glb",
    "footprint": [
      24,
      12
    ]
  },
  "kitchen_coffee_machine": {
    "glb": "kitchenCoffeeMachine.glb",
    "footprint": [
      11,
      13
    ]
  },
  "kitchen_fridge": {
    "glb": "kitchenFridge.glb",
    "footprint": [
      24,
      16
    ]
  },
  "kitchen_fridge_built_in": {
    "glb": "kitchenFridgeBuiltIn.glb",
    "footprint": [
      24,
      25
    ]
  },
  "kitchen_fridge_large": {
    "glb": "kitchenFridgeLarge.glb",
    "footprint": [
      29,
      23
    ]
  },
  "kitchen_fridge_small": {
    "glb": "kitchenFridgeSmall.glb",
    "footprint": [
      24,
      16
    ]
  },
  "kitchen_microwave": {
    "glb": "kitchenMicrowave.glb",
    "footprint": [
      16,
      13
    ]
  },
  "kitchen_sink": {
    "glb": "kitchenSink.glb",
    "footprint": [
      24,
      25
    ]
  },
  "kitchen_stove": {
    "glb": "kitchenStove.glb",
    "footprint": [
      24,
      25
    ]
  },
  "kitchen_stove_electric": {
    "glb": "kitchenStoveElectric.glb",
    "footprint": [
      24,
      25
    ]
  },
  "lamp_round_floor": {
    "glb": "lampRoundFloor.glb",
    "footprint": [
      8,
      10
    ]
  },
  "lamp_round_table": {
    "glb": "lampRoundTable.glb",
    "footprint": [
      8,
      10
    ]
  },
  "lamp_square_ceiling": {
    "glb": "lampSquareCeiling.glb",
    "footprint": [
      8,
      8
    ]
  },
  "lamp_square_floor": {
    "glb": "lampSquareFloor.glb",
    "footprint": [
      8,
      8
    ]
  },
  "lamp_square_table": {
    "glb": "lampSquareTable.glb",
    "footprint": [
      8,
      8
    ]
  },
  "lamp_wall": {
    "glb": "lampWall.glb",
    "footprint": [
      13,
      8
    ]
  },
  "laptop": {
    "glb": "laptop.glb",
    "footprint": [
      15,
      13
    ]
  },
  "lounge_chair": {
    "glb": "loungeDesignChair.glb",
    "footprint": [
      41,
      23
    ]
  },
  "lounge_chair_relax": {
    "glb": "loungeChairRelax.glb",
    "footprint": [
      27,
      37
    ]
  },
  "lounge_design_chair": {
    "glb": "loungeDesignChair.glb",
    "footprint": [
      41,
      23
    ]
  },
  "lounge_design_sofa": {
    "glb": "loungeDesignSofa.glb",
    "footprint": [
      62,
      23
    ]
  },
  "lounge_design_sofa_corner": {
    "glb": "loungeDesignSofaCorner.glb",
    "footprint": [
      75,
      75
    ]
  },
  "lounge_sofa": {
    "glb": "loungeSofa.glb",
    "footprint": [
      54,
      23
    ]
  },
  "lounge_sofa_corner": {
    "glb": "loungeSofaCorner.glb",
    "footprint": [
      54,
      54
    ]
  },
  "lounge_sofa_long": {
    "glb": "loungeSofaLong.glb",
    "footprint": [
      54,
      46
    ]
  },
  "lounge_sofa_ottoman": {
    "glb": "loungeSofaOttoman.glb",
    "footprint": [
      24,
      25
    ]
  },
  "pillow": {
    "glb": "pillow.glb",
    "footprint": [
      13,
      8
    ]
  },
  "pillow_blue": {
    "glb": "pillowBlue.glb",
    "footprint": [
      13,
      8
    ]
  },
  "pillow_blue_long": {
    "glb": "pillowBlueLong.glb",
    "footprint": [
      29,
      8
    ]
  },
  "pillow_long": {
    "glb": "pillowLong.glb",
    "footprint": [
      21,
      8
    ]
  },
  "plant_small1": {
    "glb": "plantSmall1.glb",
    "footprint": [
      8,
      8
    ]
  },
  "plant_small2": {
    "glb": "plantSmall2.glb",
    "footprint": [
      8,
      8
    ]
  },
  "plant_small3": {
    "glb": "plantSmall3.glb",
    "footprint": [
      8,
      8
    ]
  },
  "potted_plant": {
    "glb": "pottedPlant.glb",
    "footprint": [
      12,
      13
    ]
  },
  "radio": {
    "glb": "radio.glb",
    "footprint": [
      18,
      8
    ]
  },
  "rug_doormat": {
    "glb": "rugDoormat.glb",
    "footprint": [
      24,
      13
    ]
  },
  "rug_rectangle": {
    "glb": "rugRectangle.glb",
    "footprint": [
      87,
      51
    ]
  },
  "rug_round": {
    "glb": "rugRound.glb",
    "footprint": [
      51,
      51
    ]
  },
  "rug_rounded": {
    "glb": "rugRounded.glb",
    "footprint": [
      87,
      51
    ]
  },
  "rug_square": {
    "glb": "rugSquare.glb",
    "footprint": [
      50,
      51
    ]
  },
  "shower": {
    "glb": "shower.glb",
    "footprint": [
      31,
      32
    ]
  },
  "shower_round": {
    "glb": "showerRound.glb",
    "footprint": [
      31,
      31
    ]
  },
  "side_table": {
    "glb": "sideTable.glb",
    "footprint": [
      30,
      12
    ]
  },
  "side_table_drawers": {
    "glb": "sideTableDrawers.glb",
    "footprint": [
      30,
      12
    ]
  },
  "speaker": {
    "glb": "speaker.glb",
    "footprint": [
      8,
      8
    ]
  },
  "speaker_small": {
    "glb": "speakerSmall.glb",
    "footprint": [
      8,
      8
    ]
  },
  "stool_bar": {
    "glb": "stoolBar.glb",
    "footprint": [
      15,
      13
    ]
  },
  "stool_bar_square": {
    "glb": "stoolBarSquare.glb",
    "footprint": [
      9,
      8
    ]
  },
  "table": {
    "glb": "table.glb",
    "footprint": [
      47,
      25
    ]
  },
  "table_cloth": {
    "glb": "tableCloth.glb",
    "footprint": [
      47,
      25
    ]
  },
  "table_coffee": {
    "glb": "tableCoffee.glb",
    "footprint": [
      37,
      22
    ]
  },
  "table_coffee_glass": {
    "glb": "tableCoffeeGlass.glb",
    "footprint": [
      37,
      22
    ]
  },
  "table_coffee_glass_square": {
    "glb": "tableCoffeeGlassSquare.glb",
    "footprint": [
      22,
      22
    ]
  },
  "table_coffee_square": {
    "glb": "tableCoffeeSquare.glb",
    "footprint": [
      22,
      22
    ]
  },
  "table_cross": {
    "glb": "tableCross.glb",
    "footprint": [
      47,
      25
    ]
  },
  "table_cross_cloth": {
    "glb": "tableCrossCloth.glb",
    "footprint": [
      47,
      25
    ]
  },
  "table_glass": {
    "glb": "tableGlass.glb",
    "footprint": [
      47,
      25
    ]
  },
  "table_round": {
    "glb": "tableRound.glb",
    "footprint": [
      38,
      44
    ]
  },
  "television_antenna": {
    "glb": "televisionAntenna.glb",
    "footprint": [
      15,
      8
    ]
  },
  "television_modern": {
    "glb": "televisionModern.glb",
    "footprint": [
      38,
      8
    ]
  },
  "television_vintage": {
    "glb": "televisionVintage.glb",
    "footprint": [
      23,
      15
    ]
  },
  "toaster": {
    "glb": "toaster.glb",
    "footprint": [
      10,
      8
    ]
  },
  "toilet": {
    "glb": "toilet.glb",
    "footprint": [
      17,
      27
    ]
  },
  "toilet_square": {
    "glb": "toiletSquare.glb",
    "footprint": [
      17,
      22
    ]
  },
  "trashcan": {
    "glb": "trashcan.glb",
    "footprint": [
      12,
      13
    ]
  },
  "washer": {
    "glb": "washer.glb",
    "footprint": [
      22,
      22
    ]
  },
  "washer_dryer_stacked": {
    "glb": "washerDryerStacked.glb",
    "footprint": [
      22,
      22
    ]
  },
  "desk_cubicle": {
    "glb": "desk.glb",
    "footprint": [
      100,
      55
    ]
  },
  "executive_desk": {
    "glb": "deskCorner.glb",
    "footprint": [
      130,
      65
    ]
  },
  "round_table": {
    "glb": "tableRound.glb",
    "footprint": [
      120,
      120
    ]
  },
  "plant": {
    "glb": "pottedPlant.glb",
    "footprint": [
      24,
      24
    ]
  },
  "table_rect": {
    "glb": "table.glb",
    "footprint": [
      80,
      40
    ]
  },
  "coffee_machine": {
    "glb": "kitchenCoffeeMachine.glb",
    "footprint": [
      32,
      34
    ]
  },
  "fridge": {
    "glb": "kitchenFridgeSmall.glb",
    "footprint": [
      40,
      80
    ]
  },
  "water_cooler": {
    "glb": "plantSmall1.glb",
    "footprint": [
      20,
      54
    ]
  },
  "cabinet": {
    "glb": "kitchenCabinet.glb",
    "footprint": [
      200,
      40
    ]
  },
  "computer": {
    "glb": "computerScreen.glb",
    "footprint": [
      30,
      20
    ]
  },
  "lamp": {
    "glb": "lampRoundFloor.glb",
    "footprint": [
      30,
      30
    ]
  },
  "couch": {
    "glb": "loungeSofa.glb",
    "footprint": [
      100,
      40
    ]
  },
  "bookcase": {
    "glb": "bookcaseClosed.glb",
    "footprint": [
      22,
      14
    ]
  },
  "cushion_chair": {
    "glb": "chairModernCushion.glb",
    "footprint": [
      11,
      11
    ]
  },
  "coffee_table": {
    "glb": "tableCoffee.glb",
    "footprint": [
      37,
      22
    ]
  },
  "conference_table": {
    "glb": "table.glb",
    "footprint": [
      150,
      64
    ]
  },
  "guest_chair": {
    "glb": "loungeDesignChair.glb",
    "footprint": [
      41,
      23
    ]
  },
  "projection_screen": {
    "glb": null,
    "footprint": [
      110,
      14
    ],
    "procedural": true
  },
  "whiteboard": {
    "glb": null,
    "footprint": [
      10,
      80
    ],
    "procedural": true
  },
  "beanbag": {
    "glb": null,
    "footprint": [
      40,
      40
    ],
    "procedural": true
  },
  "ping_pong": {
    "glb": null,
    "footprint": [
      110,
      60
    ],
    "procedural": true
  },
  "vending": {
    "glb": null,
    "footprint": [
      40,
      60
    ],
    "procedural": true
  }
};

export const PASSABLE_TYPES = new Set([
  "avatar",
  "door",
  "computer",
  "computer_screen",
  "lamp",
  "laptop",
  "books",
  "computer_keyboard",
  "computer_mouse",
  "radio",
  "toaster",
  "bear",
  "bathroom_mirror",
  "ceiling_fan",
  "whiteboard",
]);

export function blocksNavigation(type: string) {
  if (PASSABLE_TYPES.has(type)) return false;
  if (type.startsWith("lamp")) return false;
  if (type.startsWith("pillow")) return false;
  if (type.startsWith("rug")) return false;
  return true;
}

const BUILTIN = new Set([
  "projection_screen",
  "whiteboard",
  "beanbag",
  "ping_pong",
  "vending",
]);

const GROUP_ORDER = [
  "Built-in",
  "Desks & tables",
  "Seating",
  "Lounge",
  "Kitchen",
  "Bathroom",
  "Bedroom",
  "Storage",
  "Electronics",
  "Lighting",
  "Plants",
  "Rugs",
  "Laundry",
  "More",
];

export const GROUP_SWATCH: Record<string, string> = {
  "Built-in": "#c4a05a",
  "Desks & tables": "#8b5e32",
  Seating: "#4a5568",
  Lounge: "#3d5575",
  Kitchen: "#7ea0c4",
  Bathroom: "#6a8a9a",
  Bedroom: "#7a5a78",
  Storage: "#6a4a32",
  Electronics: "#363c58",
  Lighting: "#c8a060",
  Plants: "#4a6748",
  Rugs: "#8a6038",
  Laundry: "#505a60",
  More: "#6a6578",
};

export function catalogGroup(type: string): string {
  if (BUILTIN.has(type)) return "Built-in";
  if (
    type.startsWith("kitchen") ||
    type.startsWith("hood") ||
    type === "toaster" ||
    type === "coffee_machine" ||
    type === "fridge"
  ) {
    return "Kitchen";
  }
  if (
    type.startsWith("bathroom") ||
    type.startsWith("toilet") ||
    type.startsWith("shower") ||
    type === "bathtub"
  ) {
    return "Bathroom";
  }
  if (type.startsWith("bed") || type.startsWith("cabinet_bed") || type.startsWith("pillow")) {
    return "Bedroom";
  }
  if (type.startsWith("lounge") || type === "couch") return "Lounge";
  if (
    type.startsWith("chair") ||
    type.startsWith("stool") ||
    type.includes("chair") ||
    type === "bench" ||
    type.startsWith("bench_")
  ) {
    return "Seating";
  }
  if (
    type.startsWith("table") ||
    type.startsWith("desk") ||
    type.includes("table") ||
    type === "desk_cubicle" ||
    type === "executive_desk" ||
    type === "round_table"
  ) {
    return "Desks & tables";
  }
  if (type.startsWith("lamp")) return "Lighting";
  if (type.startsWith("plant") || type === "potted_plant") return "Plants";
  if (type.startsWith("rug")) return "Rugs";
  if (
    type.startsWith("book") ||
    type.startsWith("cabinet") ||
    type.startsWith("side_table") ||
    type === "bookcase" ||
    type.startsWith("cardboard")
  ) {
    return "Storage";
  }
  if (
    type.startsWith("computer") ||
    type.startsWith("television") ||
    type === "laptop" ||
    type === "radio" ||
    type.startsWith("speaker")
  ) {
    return "Electronics";
  }
  if (type.startsWith("washer") || type === "dryer") return "Laundry";
  return "More";
}

export function groupedTypes(types: string[]): { label: string; types: string[] }[] {
  const map = new Map<string, string[]>();
  for (const type of types) {
    const group = catalogGroup(type);
    const list = map.get(group) ?? [];
    list.push(type);
    map.set(group, list);
  }
  const labels = [
    ...GROUP_ORDER.filter((label) => map.has(label)),
    ...[...map.keys()].filter((label) => !GROUP_ORDER.includes(label)),
  ];
  return labels.map((label) => ({
    label,
    types: (map.get(label) ?? []).sort(),
  }));
}
