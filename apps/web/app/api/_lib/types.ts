export type FixtureListItem = {
    fixtureId: number;
    date: string;
    statusShort: string;
    league: {
      id: number;
      name: string;
      country?: string;
      season: number;
      round?: string;
    };
    teams: {
      home: { id: number; name: string };
      away: { id: number; name: string };
    };
  };
  
  export type FixturesResponse = {
    count: number;
    fixtures: FixtureListItem[];
    cached: boolean;
  };
  
  // Prediction response shape (adapt to what you already return)
  export type PredictResponse = {
    fixtureId: number;
    model: any; // later: tighten this
    markets: {
      "1x2": any;
      btts: any;
      ou25: any;
      draw: any;
      // add more if you have them
    };
    bookmaker?: any;
    top?: any[];
    cached: boolean;
  };
  