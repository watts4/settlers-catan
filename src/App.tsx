import { useState, useEffect, useRef, useCallback } from 'react';
import type { GameState, Hex, Resource, Vertex, Edge, Port, Player, MultiplayerConfig } from './types';
import {
  createInitialGameState, rollDice, distributeResources,
  calculateVP, checkWinCondition, addLog, advanceSetupState, canAfford, BUILD_COSTS,
  getTotalResources, discardHalf,
  updateLargestArmy, updateLongestRoad,
  playKnight, playRoadBuilding, playYearOfPlenty, playMonopoly,
} from './gameState';
import { aiBestSetupSettlement, aiBestSetupRoad, aiDoFullTurn } from './ai';
import { HEX_SIZE, hexCenterPx } from './board';
import { db } from './firebase';
import { doc, updateDoc, onSnapshot } from 'firebase/firestore';
import './App.css';

// ── Multiplayer Props ──────────────────────────────────────────────────────────

interface AppProps {
  multiplayerConfig?: MultiplayerConfig;
  initialGameState?: GameState;
  onLeaveGame?: () => void;
}

// ── Dice face helper ─────────────────────────────────────────────────────────

// Dot positions for each die face on a 3x3 grid (row, col) where 0=top/left, 1=center, 2=bottom/right
const DOT_POSITIONS: Record<number, [number, number][]> = {
  1: [[1,1]],
  2: [[0,2],[2,0]],
  3: [[0,2],[1,1],[2,0]],
  4: [[0,0],[0,2],[2,0],[2,2]],
  5: [[0,0],[0,2],[1,1],[2,0],[2,2]],
  6: [[0,0],[0,2],[1,0],[1,2],[2,0],[2,2]],
};

function DiceDots({ value }: { value: number | null }) {
  if (!value) return <>?</>;
  const dots = DOT_POSITIONS[value] || [];
  return (
    <div style={{ display: 'grid', gridTemplateRows: '1fr 1fr 1fr', gridTemplateColumns: '1fr 1fr 1fr', width: '100%', height: '100%', padding: '6px', boxSizing: 'border-box' }}>
      {[0,1,2].map(r => [0,1,2].map(c => {
        const hasDot = dots.some(([dr, dc]) => dr === r && dc === c);
        return <div key={`${r}${c}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {hasDot && <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#222' }} />}
        </div>;
      }))}
    </div>
  );
}

// ── Geometry helpers ──────────────────────────────────────────────────────────

function distSq(ax: number, ay: number, bx: number, by: number) {
  return (ax - bx) ** 2 + (ay - by) ** 2;
}

function edgesShareEndpoint(e1: Edge, e2: Edge): boolean {
  const eps = 9;
  return (
    distSq(e1.x1, e1.y1, e2.x1, e2.y1) < eps ||
    distSq(e1.x1, e1.y1, e2.x2, e2.y2) < eps ||
    distSq(e1.x2, e1.y2, e2.x1, e2.y1) < eps ||
    distSq(e1.x2, e1.y2, e2.x2, e2.y2) < eps
  );
}

// ── Port geometry ─────────────────────────────────────────────────────────────

/** Pixel coords for a port: two access vertices + the dock position outside the board. */
function portPixels(port: Port) {
  const { q, r, edge } = port.location;
  const { cx, cy } = hexCenterPx(q, r);
  const a1 = (edge * Math.PI) / 3 + Math.PI / 6;
  const a2 = ((edge + 1) % 6 * Math.PI) / 3 + Math.PI / 6;
  const x1 = cx + HEX_SIZE * Math.cos(a1);
  const y1 = cy + HEX_SIZE * Math.sin(a1);
  const x2 = cx + HEX_SIZE * Math.cos(a2);
  const y2 = cy + HEX_SIZE * Math.sin(a2);
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  // Outward direction from hex centre through edge midpoint
  const dx = mx - cx; const dy = my - cy;
  const len = Math.sqrt(dx * dx + dy * dy);
  const ox = mx + (dx / len) * 32;
  const oy = my + (dy / len) * 32;
  return { x1, y1, x2, y2, ox, oy };
}

/** Best trade ratio for each resource given the player's port access. */
function getTradeRatios(game: GameState, playerId: number): Record<string, number> {
  const ratios: Record<string, number> = { wood: 4, brick: 4, sheep: 4, wheat: 4, ore: 4 };

  game.board.ports.forEach(port => {
    const { x1, y1, x2, y2 } = portPixels(port);
    const hasAccess = game.board.vertices.some(v => {
      if (!v.settlements[playerId.toString()]) return false;
      return distSq(v.x, v.y, x1, y1) < 9 || distSq(v.x, v.y, x2, y2) < 9;
    });
    if (!hasAccess) return;
    if (port.resource === 'generic') {
      Object.keys(ratios).forEach(r => { if (ratios[r] > port.ratio) ratios[r] = port.ratio; });
    } else {
      if (ratios[port.resource] > port.ratio) ratios[port.resource] = port.ratio;
    }
  });
  return ratios;
}

// ── Valid placement helpers ───────────────────────────────────────────────────

function getValidSettlementVertices(game: GameState): Vertex[] {
  const playerId = game.currentPlayer.toString();
  return game.board.vertices.filter(v => {
    if (Object.values(v.settlements).some(s => s)) return false;
    for (const other of game.board.vertices) {
      if (!Object.values(other.settlements).some(s => s)) continue;
      if (distSq(v.x, v.y, other.x, other.y) < (HEX_SIZE * 1.1) ** 2) return false;
    }
    if (game.phase === 'playing') {
      const hasRoad = game.board.edges.some(e => {
        if (!e.roads[playerId]) return false;
        return distSq(v.x, v.y, e.x1, e.y1) < 9 || distSq(v.x, v.y, e.x2, e.y2) < 9;
      });
      if (!hasRoad) return false;
    }
    return true;
  });
}

function getValidRoadEdgesSetup(game: GameState): Edge[] {
  const lastId = game.setupLastSettlementVertexId;
  if (!lastId) return [];
  const vertex = game.board.vertices.find(v => v.id === lastId);
  if (!vertex) return [];
  return game.board.edges.filter(e => {
    if (Object.values(e.roads).some(r => r)) return false;
    return distSq(vertex.x, vertex.y, e.x1, e.y1) < 9 ||
           distSq(vertex.x, vertex.y, e.x2, e.y2) < 9;
  });
}

function getValidRoadEdges(game: GameState): Edge[] {
  const playerId = game.currentPlayer.toString();
  return game.board.edges.filter(e => {
    if (Object.values(e.roads).some(r => r)) return false;
    const endpoints = game.board.vertices.filter(
      v => distSq(v.x, v.y, e.x1, e.y1) < 9 || distSq(v.x, v.y, e.x2, e.y2) < 9
    );
    for (const v of endpoints) { if (v.settlements[playerId]) return true; }
    for (const other of game.board.edges) {
      if (!other.roads[playerId]) continue;
      if (edgesShareEndpoint(e, other)) return true;
    }
    return false;
  });
}

function getAdjacentResources(game: GameState, vertexId: string): Resource[] {
  const vertex = game.board.vertices.find(v => v.id === vertexId);
  if (!vertex) return [];
  return game.board.hexes
    .filter(hex => {
      if (hex.resource === 'desert') return false;
      const { cx, cy } = hexCenterPx(hex.q, hex.r);
      return Math.sqrt(distSq(vertex.x, vertex.y, cx, cy)) <= HEX_SIZE + 2;
    })
    .map(hex => hex.resource as Resource);
}

// ── Display config ────────────────────────────────────────────────────────────

const RESOURCES: Resource[] = ['wood', 'brick', 'sheep', 'wheat', 'ore'];

// Icons used in UI (player cards, build buttons, trade, log)
const HEX_ICON: Record<Resource, string> = {
  wood: '🌲', brick: '🧱', sheep: '🐑', wheat: '🌾', ore: '⛰️', desert: '🏜️', gold: '💰',
};

// Large illustrated emoji shown on each hex tile — no text labels, just visual art
const HEX_TILE_EMOJI: Record<Resource, string[]> = {
  wood:   ['🌲', '🌲', '🌲'],  // three trees
  brick:  ['🧱'],              // brick
  sheep:  ['🐑', '🐑'],        // sheep
  wheat:  ['🌾', '🌾'],        // wheat sheaves
  ore:    ['⛰️', '⛰️'],        // mountains + stone
  desert: ['🏜️'],              // desert
  gold:   ['💰'],
};

const HEX_COLOR: Record<Resource, string> = {
  wood:   '#1e4d1a',  // deep forest green
  brick:  '#7a3010',  // terracotta/clay
  sheep:  '#6db84a',  // pasture green
  wheat:  '#c8961e',  // golden fields
  ore:    '#5a6470',  // slate gray
  desert: '#c8aa6e',  // sandy tan
  gold:   '#d4a017',
};

// Number of probability dots for each dice number (2-dice combinations out of 36)
// 2→1, 3→2, 4→3, 5→4, 6→5, 8→5, 9→4, 10→3, 11→2, 12→1
const PROBABILITY_DOTS: Record<number, number> = {
  2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1,
};

const PORT_ICON: Record<string, string> = {
  wood: '🌲', brick: '🧱', sheep: '🐑', wheat: '🌾', ore: '⛰️', generic: '⚓',
};

// ── Resource gain computation (mirrors distributeResources but returns gains) ─

interface ResourceGain {
  playerId: number;
  resource: Resource;
  amount: number;
  id: number; // unique key for React
}

let gainIdCounter = 0;

function computeResourceGains(state: GameState, diceSum: number): ResourceGain[] {
  if (diceSum === 7) return [];
  const gains: ResourceGain[] = [];
  state.board.hexes.forEach(hex => {
    if (hex.number === diceSum && !hex.hasRobber) {
      const { cx, cy } = hexCenterPx(hex.q, hex.r);
      const hexVertices = state.board.vertices.filter(v => {
        const dx = v.x - cx, dy = v.y - cy;
        return Math.sqrt(dx * dx + dy * dy) <= HEX_SIZE + 2;
      });
      hexVertices.forEach(vertex => {
        Object.entries(vertex.settlements).forEach(([playerId, type]) => {
          if (type && hex.resource !== 'desert' && hex.resource !== 'gold') {
            const amount = type === 'settlement' ? 1 : 2;
            for (let i = 0; i < amount; i++) {
              gains.push({ playerId: parseInt(playerId), resource: hex.resource as Resource, amount: 1, id: ++gainIdCounter });
            }
          }
        });
      });
    }
  });
  return gains;
}

// ── App ───────────────────────────────────────────────────────────────────────

function App({ multiplayerConfig, initialGameState, onLeaveGame }: AppProps) {
  const [game, setGame] = useState<GameState>(initialGameState ?? createInitialGameState());
  // Ref mirror of game state — allows synchronous reads outside React's render cycle
  // (e.g. inside setTimeout callbacks and executeAITurn which must not rely on setGame updaters)
  const gameRef = useRef(game);
  useEffect(() => { gameRef.current = game; }, [game]);
  const [buildingMode, setBuildingMode] = useState<'road' | 'settlement' | 'city' | null>(null);
  const [tradeOffer, setTradeOffer] = useState<Partial<Record<Resource, number>>>({});
  const [tradeRequest, setTradeRequest] = useState<Partial<Record<Resource, number>>>({});
  const [buildError, setBuildError] = useState<string | null>(null);
  const [devCardMode, setDevCardMode] = useState<'knight' | 'road' | 'plenty' | 'monopoly' | null>(null);
  const [devCardModalOpen, setDevCardModalOpen] = useState(false);
  const [bankTradeModalOpen, setBankTradeModalOpen] = useState(false);
  const [playerTradeModalOpen, setPlayerTradeModalOpen] = useState(false);
  const [buildModalOpen, setBuildModalOpen] = useState(false);
  const [roadBuildingRoadsLeft, setRoadBuildingRoadsLeft] = useState(0);
  const [yearOfPlentyPicks, setYearOfPlentyPicks] = useState<Resource[]>([]);
  const [devCardPlayedThisTurn, setDevCardPlayedThisTurn] = useState(false);
  // Tracks how many of each dev card type the player owned at the START of their turn.
  // Cards bought mid-turn are not in this snapshot and therefore can't be played.
  const [devHandAtTurnStart, setDevHandAtTurnStart] = useState<Record<string, number>>({});
  const [playerTradeOffer, setPlayerTradeOffer] = useState<Partial<Record<Resource, number>>>({});
  const [playerTradeRequest, setPlayerTradeRequest] = useState<Partial<Record<Resource, number>>>({});
  const [playerTradeResponses, setPlayerTradeResponses] = useState<{ playerId: number; accepts: boolean; isPending?: boolean }[]>([]);
  const [isRolling, setIsRolling] = useState(false);
  const [animDice, setAnimDice] = useState<[number, number]>([1, 1]);
  const [flashDice, setFlashDice] = useState<[number, number] | null>(null);
  // Resource fly animation
  const [flyingResources, setFlyingResources] = useState<ResourceGain[]>([]);
  const playerCardRefs = useRef<(HTMLDivElement | null)[]>([null, null, null, null]);
  // Refs to track animation timeouts so they can be cancelled on overlapping AI turns
  const flashDiceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flyingResStartRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flyingResClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards against concurrent AI turn execution (race between useEffect + timers)
  const aiTurnInProgressRef = useRef(false);
  // Tracks that a trade proposal is being deferred (set synchronously, before the 1400ms setTimeout fires)
  const pendingTradeRef = useRef(false);
  // AI-initiated trade proposal — shown to human during AI's turn
  const [aiTradeProposal, setAiTradeProposal] = useState<{
    fromPlayer: number;
    offering: Partial<Record<Resource, number>>;
    requesting: Partial<Record<Resource, number>>;
    pendingState: GameState;
  } | null>(null);
  // Counter-offer state
  const [counterMode, setCounterMode] = useState(false);
  const [counterOffering, setCounterOffering] = useState<Partial<Record<Resource, number>>>({});
  const [counterRequesting, setCounterRequesting] = useState<Partial<Record<Resource, number>>>({});
  const [counterResult, setCounterResult] = useState<'accepted' | 'declined' | null>(null);

  // Multiplayer: incoming trade offer from another human player
  const [incomingHumanTrade, setIncomingHumanTrade] = useState<{
    fromPlayer: number;
    offering: Partial<Record<Resource, number>>;
    requesting: Partial<Record<Resource, number>>;
  } | null>(null);
  // Ref mirror of aiTradeProposal for use in effects without stale-closure issues
  const aiTradeProposalRef = useRef<typeof aiTradeProposal>(null);
  // Refs to track pending trade IDs across Firestore updates
  const prevPendingAiTradeIdRef = useRef<string | null>(null);
  const prevPendingHumanTradeIdRef = useRef<string | null>(null);
  // Tracks a human trade that WE proposed (so we know when it gets resolved)
  const myPendingHumanTradeIdRef = useRef<string | null>(null);

  // Discard UI state — shown when a 7 is rolled and human has 8+ cards
  const [humanDiscardPending, setHumanDiscardPending] = useState<{ toDiscard: number } | null>(null);
  const [discardSelection, setDiscardSelection] = useState<Partial<Record<Resource, number>>>({});

  // ── Board pan/zoom state ─────────────────────────────────────────────────
  const DEFAULT_VB = { x: -350, y: -290, w: 700, h: 580 }; // initial view — tight on hex grid
  const TABLE_VB = { x: -700, y: -580, w: 1400, h: 1160 }; // full table bounds
  const MIN_VB_SIZE = 300; // max zoom in
  const MAX_VB_SIZE = TABLE_VB.w; // max zoom out = full table
  const [viewBox, setViewBox] = useState(DEFAULT_VB);
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0, vbx: 0, vby: 0 });
  const panMoved = useRef(false);
  const svgRef = useRef<SVGSVGElement>(null);
  // Pinch-to-zoom tracking
  const pinchStartDist = useRef(0);
  const pinchStartVB = useRef({ x: 0, y: 0, w: 0, h: 0 });
  const pinchMidRef = useRef({ x: 0, y: 0 });
  const afterHumanDiscardRef = useRef<((s: GameState) => GameState) | null>(null);

  // ── Multiplayer sync ────────────────────────────────────────────────────────
  const lastSyncId = useRef('');
  const isExternalUpdate = useRef(false);
  // Safety guard: non-host must not write to Firestore until it has the real game state
  const hasInitialState = useRef(!multiplayerConfig || multiplayerConfig.isHost || !!initialGameState);

  // Listen to Firestore for game state changes from other players
  useEffect(() => {
    if (!multiplayerConfig?.roomId) return;
    const roomRef = doc(db, 'games', multiplayerConfig.roomId);
    return onSnapshot(roomRef, snap => {
      const data = snap.data();
      if (!data?.gameState || !data?.syncId) return;
      if (data.syncId === lastSyncId.current) return; // our own write echoing back
      hasInitialState.current = true;
      isExternalUpdate.current = true;
      setGame(data.gameState as GameState);
    });
  }, [multiplayerConfig?.roomId]);

  // Write game state to Firestore when it changes (skip external updates)
  useEffect(() => {
    if (!multiplayerConfig?.roomId) return;
    if (!hasInitialState.current) return; // non-host hasn't received real state yet
    if (isExternalUpdate.current) {
      isExternalUpdate.current = false;
      return;
    }
    const syncId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    lastSyncId.current = syncId;
    updateDoc(doc(db, 'games', multiplayerConfig.roomId), {
      gameState: JSON.parse(JSON.stringify(game)),
      syncId,
      updatedAt: Date.now(),
    }).catch(console.error);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game]);

  // Copy invite link to clipboard
  const handleCopyInviteLink = useCallback(() => {
    if (!multiplayerConfig?.roomId) return;
    const url = `${window.location.origin}${window.location.pathname}?room=${multiplayerConfig.roomId}`;
    navigator.clipboard.writeText(url).catch(() => {});
  }, [multiplayerConfig?.roomId]);

  // ── Derived state ────────────────────────────────────────────────────────────
  const currentPlayer = game.players[game.currentPlayer];
  const isSetup = game.phase === 'setup1' || game.phase === 'setup2';
  const isHumanTurn = currentPlayer?.isHuman;
  // In multiplayer: only act when it's YOUR slot's turn. In solo: same as isHumanTurn.
  const isMyTurn = multiplayerConfig
    ? game.currentPlayer === multiplayerConfig.mySlot
    : isHumanTurn;

  // Affordability checks (only relevant during playing phase)
  const canBuildRoad = canAfford(currentPlayer, BUILD_COSTS.road);
  const canBuildSettlement = canAfford(currentPlayer, BUILD_COSTS.settlement);
  const canBuildCity = canAfford(currentPlayer, BUILD_COSTS.city);
  const canBuildDevCard = canAfford(currentPlayer, BUILD_COSTS.devCard) && game.devCardDeck.length > 0;

  // Robber state: human moves robber after rolling 7
  const [robbingMode, setRobbingMode] = useState(false);
  const [stealCandidates, setStealCandidates] = useState<Player[]>([]);

  // True while the human must move the robber or choose who to steal from
  const mustMoveRobber = robbingMode || stealCandidates.length > 0;
  const mustDiscard = !!humanDiscardPending;

  // ── Solo game persistence ─────────────────────────────────────────────────
  useEffect(() => {
    if (multiplayerConfig) return; // only for solo
    if (game.phase === 'gameOver') {
      localStorage.removeItem('catan_solo_save');
      return;
    }
    try {
      localStorage.setItem('catan_solo_save', JSON.stringify(game));
    } catch { /* storage full — ignore */ }
  }, [game, multiplayerConfig]);

  // Clear build error after 3 seconds
  useEffect(() => {
    if (!buildError) return;
    const t = setTimeout(() => setBuildError(null), 3000);
    return () => clearTimeout(t);
  }, [buildError]);

  // Reset turn-local state when a new human turn begins (after AI turns)
  useEffect(() => {
    if (game.players[game.currentPlayer]?.isHuman && game.phase === 'playing') {
      setDevCardPlayedThisTurn(false);
      setDevCardMode(null);
      setRoadBuildingRoadsLeft(0);
      setYearOfPlentyPicks([]);
      // Snapshot the hand so newly-bought cards are blocked from play this turn
      const hand = game.players[game.currentPlayer].devCards;
      const counts: Record<string, number> = {};
      for (const c of hand) counts[c] = (counts[c] ?? 0) + 1;
      setDevHandAtTurnStart(counts);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.currentPlayer]);

  // ── AI auto-placement during setup (smart: score by probability) ────────────
  useEffect(() => {
    // In multiplayer: only host handles AI turns
    const shouldHandleAI = multiplayerConfig ? multiplayerConfig.isHost : true;
    if (!isSetup || isHumanTurn || !shouldHandleAI) return;
    const timeout = setTimeout(() => {
      if (game.setupStep === 'settlement') {
        const vertexId = aiBestSetupSettlement(game);
        if (vertexId) doPlaceSettlement(game, vertexId);
      } else {
        const edgeId = aiBestSetupRoad(game);
        if (edgeId) doPlaceRoad(game, edgeId);
      }
    }, 700);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.currentPlayer, game.phase, game.setupStep]);

  // ── Animation helpers (defined before AI turn logic which uses them) ────────
  const showDiceFlash = useCallback((dice: [number, number]) => {
    // Cancel any previous dice flash clear timeout to prevent it from
    // clearing THIS flash when AI turns overlap
    if (flashDiceTimeoutRef.current) clearTimeout(flashDiceTimeoutRef.current);
    setFlashDice(dice);
    flashDiceTimeoutRef.current = setTimeout(() => {
      setFlashDice(null);
      flashDiceTimeoutRef.current = null;
    }, 1200);
  }, []);

  const showResourceGains = useCallback((gains: ResourceGain[]) => {
    if (gains.length === 0) return;
    // Cancel any previous resource animation timeouts to prevent them from
    // clearing THIS animation when AI turns overlap
    if (flyingResStartRef.current) clearTimeout(flyingResStartRef.current);
    if (flyingResClearRef.current) clearTimeout(flyingResClearRef.current);
    // Stagger each gain slightly so they don't all fly at once
    flyingResStartRef.current = setTimeout(() => {
      setFlyingResources(gains);
      flyingResStartRef.current = null;
      flyingResClearRef.current = setTimeout(() => {
        setFlyingResources([]);
        flyingResClearRef.current = null;
      }, 1200);
    }, 600); // start after dice flash is mostly visible
  }, []);

  // ── AI playing turn ──────────────────────────────────────────────────────────
  // Delay between AI turns — enough time for dice + resource animations
  const AI_TURN_DELAY = 1800;

  const executeAITurn = useCallback((aiPlayerId: number) => {
    // Prevent concurrent AI turn execution
    if (aiTurnInProgressRef.current) return;
    aiTurnInProgressRef.current = true;

    // Read current state synchronously via ref (NOT inside setGame updater)
    const prev = gameRef.current;
    if (prev.currentPlayer !== aiPlayerId || prev.players[aiPlayerId].isHuman) {
      aiTurnInProgressRef.current = false;
      return;
    }

    // Roll dice
    const dice = rollDice();
    const sum = dice[0] + dice[1];

    // Cancel any in-flight animation timeouts before starting new ones
    if (flashDiceTimeoutRef.current) { clearTimeout(flashDiceTimeoutRef.current); flashDiceTimeoutRef.current = null; }
    if (flyingResStartRef.current) { clearTimeout(flyingResStartRef.current); flyingResStartRef.current = null; }
    if (flyingResClearRef.current) { clearTimeout(flyingResClearRef.current); flyingResClearRef.current = null; }
    setFlashDice(null);
    setFlyingResources([]);

    // Compute resource gains for fly animation
    const gains = sum !== 7 ? computeResourceGains(prev, sum) : [];
    showDiceFlash(dice);
    if (gains.length > 0) showResourceGains(gains);

    // Deep clone so we can freely mutate (distributeResources/discardHalf mutate in-place)
    const afterRoll: GameState = JSON.parse(JSON.stringify({ ...prev, dice }));
    if (sum !== 7) {
      distributeResources(afterRoll, sum);
    } else {
      // Auto-discard AI players only; human will choose via UI
      for (const p of afterRoll.players) {
        if (!p.isHuman && getTotalResources(p) >= 8) discardHalf(afterRoll, p.id);
      }
      const humansToDiscard = afterRoll.players
        .filter(p => p.isHuman && getTotalResources(p) >= 8)
        .map(p => p.id);
      if (humansToDiscard.length > 0) {
        afterRoll.playersToDiscard = humansToDiscard;
      }
    }
    addLog(afterRoll, `${prev.players[aiPlayerId].name} rolled ${dice[0]}+${dice[1]}=${sum}`);

    // If any human needs to discard, pause here — each client shows discard UI
    if (afterRoll.playersToDiscard.length > 0) {
      aiTurnInProgressRef.current = false;
      setGame(afterRoll);
      return;
    }

    // ~45% chance the AI proposes a trade with a human player before acting
    const humanPlayers = afterRoll.players.filter(p => p.isHuman);
    if (humanPlayers.length > 0 && Math.random() < 0.45) {
      const aiPlayer = afterRoll.players[aiPlayerId];
      const TRADEABLE = (['wood', 'brick', 'sheep', 'wheat', 'ore'] as Resource[]);
      const excess = TRADEABLE.filter(r => (aiPlayer.resources[r] || 0) >= 2);
      const needs = TRADEABLE.filter(r => (aiPlayer.resources[r] || 0) <= 1);
      if (excess.length > 0 && needs.length > 0) {
        const offer = excess.sort((a, b) => (aiPlayer.resources[b] || 0) - (aiPlayer.resources[a] || 0))[0];
        const request = needs.sort((a, b) => (aiPlayer.resources[a] || 0) - (aiPlayer.resources[b] || 0))[0];
        const tradeData = {
          fromPlayer: aiPlayerId,
          offering: { [offer]: 1 } as Partial<Record<Resource, number>>,
          requesting: { [request]: 1 } as Partial<Record<Resource, number>>,
          pendingState: afterRoll,
        };
        // Set state immediately; aiTurnInProgressRef stays true until human responds
        pendingTradeRef.current = true;
        setGame(afterRoll);
        // Show trade proposal after dice flash animation finishes
        setTimeout(() => {
          pendingTradeRef.current = false;
          const tradeId = `ai-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          setAiTradeProposal(tradeData);
          // Embed trade in game state so Firestore syncs it to all clients
          setGame(prev => ({
            ...prev,
            pendingAiTrade: {
              tradeId,
              fromPlayer: aiPlayerId,
              offering: { [offer]: 1 } as Partial<Record<Resource, number>>,
              requesting: { [request]: 1 } as Partial<Record<Resource, number>>,
            },
          }));
        }, 1400);
        return;
      }
    }

    // No trade — run full AI turn and advance to next player
    const result = aiDoFullTurn(afterRoll);
    aiTurnInProgressRef.current = false;
    setGame(result);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDiceFlash, showResourceGains]);

  useEffect(() => {
    // In multiplayer: only host handles AI turns
    const shouldHandleAI = multiplayerConfig ? multiplayerConfig.isHost : true;
    const aiPlayerId = game.currentPlayer;
    if (game.phase !== 'playing' || game.players[aiPlayerId]?.isHuman || !shouldHandleAI) return;
    if (aiTradeProposal) return; // already waiting for human response
    if (pendingTradeRef.current) return; // trade proposal being deferred (not yet in state)
    if (aiTurnInProgressRef.current) return; // another AI turn is already executing

    const timer = setTimeout(() => executeAITurn(aiPlayerId), AI_TURN_DELAY);

    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.currentPlayer, game.phase, game.turn, aiTradeProposal]);

  // Keep ref in sync with aiTradeProposal state (for use in effects)
  useEffect(() => { aiTradeProposalRef.current = aiTradeProposal; }, [aiTradeProposal]);

  // Multiplayer: non-host clients detect AI trade proposals from synced game state
  useEffect(() => {
    if (!multiplayerConfig) return;
    const pending = game.pendingAiTrade;
    if (pending && pending.tradeId !== prevPendingAiTradeIdRef.current) {
      prevPendingAiTradeIdRef.current = pending.tradeId;
      if (!multiplayerConfig.isHost) {
        // Show the AI trade modal on non-host clients
        setAiTradeProposal({
          fromPlayer: pending.fromPlayer,
          offering: pending.offering,
          requesting: pending.requesting,
          pendingState: game,
        });
      }
    } else if (!pending && prevPendingAiTradeIdRef.current) {
      prevPendingAiTradeIdRef.current = null;
      // Trade was resolved externally — close modal if it was showing an AI trade
      if (aiTradeProposalRef.current) {
        setAiTradeProposal(null);
        setCounterMode(false);
        setCounterResult(null);
        setPlayerTradeModalOpen(false);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.pendingAiTrade]);

  // Multiplayer host: resume AI turn after a non-host resolved the AI trade
  useEffect(() => {
    if (!multiplayerConfig?.isHost) return;
    if (!game.pendingAiTurn) return;
    setAiTradeProposal(null);
    setCounterMode(false);
    setCounterResult(null);
    setGame(prev => {
      const stateToProcess = { ...prev, pendingAiTurn: false };
      const result = aiDoFullTurn(stateToProcess);
      aiTurnInProgressRef.current = false;
      return result;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.pendingAiTurn]);

  // Multiplayer: detect incoming human trade proposals from synced game state
  useEffect(() => {
    if (!multiplayerConfig) return;
    const pending = game.pendingHumanTrade;
    if (pending && pending.tradeId !== prevPendingHumanTradeIdRef.current) {
      prevPendingHumanTradeIdRef.current = pending.tradeId;
      // Show incoming trade modal to all human players except the offerer
      if (pending.fromPlayer !== multiplayerConfig.mySlot) {
        setIncomingHumanTrade({
          fromPlayer: pending.fromPlayer,
          offering: pending.offering,
          requesting: pending.requesting,
        });
      }
    } else if (!pending && prevPendingHumanTradeIdRef.current) {
      prevPendingHumanTradeIdRef.current = null;
      setIncomingHumanTrade(null);
      // If WE were the offerer, close our responses view
      if (myPendingHumanTradeIdRef.current) {
        myPendingHumanTradeIdRef.current = null;
        setPlayerTradeResponses([]);
        setPlayerTradeOffer({});
        setPlayerTradeRequest({});
        setPlayerTradeModalOpen(false);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.pendingHumanTrade]);

  // ── Multiplayer discard: watch playersToDiscard from game state ───────────
  useEffect(() => {
    const myId = multiplayerConfig ? multiplayerConfig.mySlot : (game.players.find(p => p.isHuman)?.id ?? 0);
    if (game.playersToDiscard.includes(myId) && !humanDiscardPending) {
      const myPlayer = game.players[myId];
      const count = Math.floor(getTotalResources(myPlayer) / 2);
      if (count > 0) {
        setHumanDiscardPending({ toDiscard: count });
        setDiscardSelection({});
        // After discard, if it was during AI turn, the host will continue the AI turn
        // once all humans have discarded (playersToDiscard is empty)
        afterHumanDiscardRef.current = null;
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.playersToDiscard]);

  // ── Core placement ────────────────────────────────────────────────────────

  function doPlaceSettlement(prev: GameState, vertexId: string) {
    const player = prev.players[prev.currentPlayer];
    setGame(state => {
      const newGame: GameState = {
        ...state,
        board: {
          ...state.board,
          vertices: state.board.vertices.map(v =>
            v.id !== vertexId ? v
              : { ...v, settlements: { ...v.settlements, [player.id]: 'settlement' as const } }
          ),
        },
        players: state.players.map(p =>
          p.id !== player.id ? p : { ...p, pieces: { ...p.pieces, settlements: p.pieces.settlements - 1 } }
        ),
        setupStep: 'road',
        setupLastSettlementVertexId: vertexId,
      };
      if (state.phase === 'setup2') {
        const resources = getAdjacentResources(state, vertexId);
        const resMap = { ...newGame.players[player.id].resources };
        for (const r of resources) resMap[r] = (resMap[r] || 0) + 1;
        newGame.players = newGame.players.map(p =>
          p.id !== player.id ? p : { ...p, resources: resMap }
        );
        addLog(newGame, `${player.name} placed settlement → got: ${resources.map(r => HEX_ICON[r]).join(' ') || 'nothing'}`);
      } else {
        addLog(newGame, `${player.name} placed a settlement`);
      }
      return newGame;
    });
    setBuildingMode(null);
  }

  function doPlaceRoad(prev: GameState, edgeId: string) {
    const player = prev.players[prev.currentPlayer];
    setGame(state => {
      const newGame: GameState = {
        ...state,
        board: {
          ...state.board,
          edges: state.board.edges.map(e =>
            e.id !== edgeId ? e : { ...e, roads: { ...e.roads, [player.id]: 'road' as const } }
          ),
        },
        players: state.players.map(p =>
          p.id !== player.id ? p : { ...p, pieces: { ...p.pieces, roads: p.pieces.roads - 1 } }
        ),
      };
      if (state.phase === 'setup1' || state.phase === 'setup2') {
        advanceSetupState(newGame);
      } else {
        newGame.players = newGame.players.map(p =>
          p.id !== player.id ? p : {
            ...p,
            resources: { ...p.resources, wood: (p.resources.wood || 0) - 1, brick: (p.resources.brick || 0) - 1 },
          }
        );
        updateLongestRoad(newGame);
      }
      addLog(newGame, `${player.name} placed a road`);
      return newGame;
    });
    setBuildingMode(null);
  }

  // ── Human action handlers ────────────────────────────────────────────────────

  const handlePlaceSettlement = (vertexId: string) => doPlaceSettlement(game, vertexId);
  const handlePlaceRoad       = (edgeId: string)   => doPlaceRoad(game, edgeId);

  const handlePlaceSettlementPlaying = (vertexId: string) => {
    if (!canBuildSettlement) { setBuildError('Not enough resources! Need 1🌲 1🧱 1🌾 1🐑'); return; }
    const player = currentPlayer;
    setGame(prev => {
      const newGame: GameState = {
        ...prev,
        board: {
          ...prev.board,
          vertices: prev.board.vertices.map(v =>
            v.id !== vertexId ? v
              : { ...v, settlements: { ...v.settlements, [player.id]: 'settlement' as const } }
          ),
        },
        players: prev.players.map(p =>
          p.id !== player.id ? p : {
            ...p,
            resources: {
              ...p.resources,
              wood: (p.resources.wood || 0) - 1, brick: (p.resources.brick || 0) - 1,
              wheat: (p.resources.wheat || 0) - 1, sheep: (p.resources.sheep || 0) - 1,
            },
            pieces: { ...p.pieces, settlements: p.pieces.settlements - 1 },
          }
        ),
      };
      addLog(newGame, `${player.name} built a settlement`);
      updateLongestRoad(newGame);
      // Check win condition immediately
      for (const p of newGame.players) p.victoryPoints = calculateVP(p, newGame);
      const w = checkWinCondition(newGame);
      if (w !== null) { newGame.winner = w; newGame.phase = 'gameOver'; }
      return newGame;
    });
    setBuildingMode(null);
  };

  const handlePlaceRoadPlaying = (edgeId: string) => {
    if (roadBuildingRoadsLeft > 0) {
      // Free road from Road Building dev card
      const player = game.players[game.currentPlayer];
      setGame(prev => {
        const newGame: GameState = {
          ...prev,
          board: {
            ...prev.board,
            edges: prev.board.edges.map(e =>
              e.id !== edgeId ? e : { ...e, roads: { ...e.roads, [player.id]: 'road' as const } }
            ),
          },
          players: prev.players.map(p =>
            p.id !== player.id ? p : { ...p, pieces: { ...p.pieces, roads: p.pieces.roads - 1 } }
          ),
        };
        updateLongestRoad(newGame);
        addLog(newGame, `${player.name} placed a free road`);
        return newGame;
      });
      setRoadBuildingRoadsLeft(prev => {
        const next = prev - 1;
        if (next === 0) setBuildingMode(null);
        return next;
      });
      return;
    }
    if (!canBuildRoad) { setBuildError('Not enough resources! Need 1🌲 1🧱'); return; }
    doPlaceRoad(game, edgeId);
  };

  // ── Dice sound (Web Audio API, no external files) ────────────────────────────
  function playDiceSound() {
    try {
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const duration = 0.75;
      const sr = ctx.sampleRate;
      const buf = ctx.createBuffer(1, sr * duration, sr);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const env = Math.exp(-t * 7);          // overall decay
        const noise = (Math.random() * 2 - 1) * env;
        // simulate periodic tumble clicks
        const clicks = Math.sin(t * (10 + t * 18) * Math.PI * 2) > 0.88 ? env * 0.7 : 0;
        d[i] = noise * 0.35 + clicks;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1100;
      filter.Q.value = 0.6;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.55, ctx.currentTime);
      src.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
      src.start(); src.stop(ctx.currentTime + duration);
    } catch { /* audio unavailable */ }
  }

  // Cycle random faces while rolling
  useEffect(() => {
    if (!isRolling) return;
    const id = setInterval(() => {
      setAnimDice([
        Math.ceil(Math.random() * 6) as 1|2|3|4|5|6,
        Math.ceil(Math.random() * 6) as 1|2|3|4|5|6,
      ]);
    }, 75);
    return () => clearInterval(id);
  }, [isRolling]);

  const handleRollDice = () => {
    if (isRolling) return;
    const dice = rollDice();
    const sum = dice[0] + dice[1];

    playDiceSound();
    setIsRolling(true);

    // Pre-check human discard need from current state (resources don't change during roll)
    const myPlayer = multiplayerConfig
      ? game.players[multiplayerConfig.mySlot]
      : game.players.find(p => p.isHuman);
    const humanNeedsDiscard = sum === 7 && !!myPlayer && getTotalResources(myPlayer) >= 8;
    const humanDiscardCount = humanNeedsDiscard ? Math.floor(getTotalResources(myPlayer!) / 2) : 0;

    // Pre-compute resource gains for animation (before state mutation)
    const gains = sum !== 7 ? computeResourceGains(game, sum) : [];

    setTimeout(() => {
      setIsRolling(false);
      showDiceFlash(dice);
      if (gains.length > 0) showResourceGains(gains);
      setGame(prev => {
        const newGame = { ...prev, dice };
        if (sum !== 7) {
          distributeResources(newGame, sum);
        } else {
          for (const p of newGame.players) {
            // Auto-discard AI players only; human will choose via UI
            if (!p.isHuman && getTotalResources(p) >= 8) discardHalf(newGame, p.id);
          }
          // In multiplayer, track ALL human players who need to discard
          if (multiplayerConfig) {
            const humansToDiscard = newGame.players
              .filter(p => p.isHuman && getTotalResources(p) >= 8)
              .map(p => p.id);
            newGame.playersToDiscard = humansToDiscard;
          }
        }
        addLog(newGame, `Rolled ${dice[0]} + ${dice[1]} = ${sum}`);
        return newGame;
      });
      if (sum === 7) {
        setBuildingMode(null);
        setTradeOffer({}); setTradeRequest({});
        if (humanNeedsDiscard) {
          setHumanDiscardPending({ toDiscard: humanDiscardCount });
          setDiscardSelection({});
          afterHumanDiscardRef.current = null; // null = human's turn; set robbingMode after
        } else {
          setRobbingMode(true);
        }
      }
    }, 800);
  };

  const handleConfirmDiscard = () => {
    if (!humanDiscardPending) return;
    const total = RESOURCES.reduce((s, r) => s + (discardSelection[r] || 0), 0);
    if (total !== humanDiscardPending.toDiscard) return;

    const afterDiscard = afterHumanDiscardRef.current;
    afterHumanDiscardRef.current = null;
    const sel = { ...discardSelection };
    const discardCount = humanDiscardPending.toDiscard;

    const myId = multiplayerConfig ? multiplayerConfig.mySlot : (game.players.find(p => p.isHuman)?.id ?? 0);
    setGame(prev => {
      const newGame = { ...prev };
      newGame.players = newGame.players.map(p => {
        if (p.id !== myId) return p;
        const resources = { ...p.resources };
        for (const r of RESOURCES) {
          resources[r] = Math.max(0, (resources[r] || 0) - (sel[r] || 0));
        }
        return { ...p, resources };
      });
      // Remove this player from playersToDiscard
      newGame.playersToDiscard = newGame.playersToDiscard.filter(id => id !== myId);
      const discardPlayer = newGame.players[myId];
      addLog(newGame, `${discardPlayer?.name ?? 'You'} discarded ${discardCount} card(s)`);

      // If this was during our own turn (afterDiscard is set), apply the continuation
      if (afterDiscard) return afterDiscard(newGame);

      // If all humans done discarding during AI turn, host continues AI turn
      const shouldHandleAI = multiplayerConfig ? multiplayerConfig.isHost : true;
      if (newGame.playersToDiscard.length === 0 && !newGame.players[newGame.currentPlayer].isHuman && shouldHandleAI) {
        return aiDoFullTurn(newGame);
      }
      return newGame;
    });

    setHumanDiscardPending(null);
    setDiscardSelection({});
    if (!afterDiscard && game.players[game.currentPlayer]?.id === myId) {
      // Human's own turn — now show robber movement
      setRobbingMode(true);
    }
  };

  const handleEndTurn = () => {
    setBuildingMode(null);
    setTradeOffer({}); setTradeRequest({});
    setDevCardMode(null);
    setRoadBuildingRoadsLeft(0);
    setYearOfPlentyPicks([]);
    setDevCardPlayedThisTurn(false);
    setPlayerTradeOffer({}); setPlayerTradeRequest({}); setPlayerTradeResponses([]);
    setBankTradeModalOpen(false); setPlayerTradeModalOpen(false); setBuildModalOpen(false);
    setGame(prev => {
      // Update VP for all players and check win condition before advancing
      for (const p of prev.players) {
        p.victoryPoints = calculateVP(p, prev);
      }
      const winner = checkWinCondition(prev);
      if (winner !== null) {
        return { ...prev, winner, phase: 'gameOver' };
      }
      return {
        ...prev,
        currentPlayer: (prev.currentPlayer + 1) % 4,
        turn: prev.turn + 1,
        dice: null,
      };
    });
  };

  const handleNewGame = () => {
    setBuildingMode(null); setTradeOffer({}); setTradeRequest({}); setBuildError(null);
    setDevCardMode(null); setRoadBuildingRoadsLeft(0); setYearOfPlentyPicks([]);
    setDevCardPlayedThisTurn(false); setDevHandAtTurnStart({});
    setPlayerTradeOffer({}); setPlayerTradeRequest({}); setPlayerTradeResponses([]);
    setAiTradeProposal(null);
    localStorage.removeItem('catan_solo_save');
    setGame(createInitialGameState());
  };

  const handleBuildToggle = (type: 'road' | 'settlement' | 'city') => {
    if (type === 'road' && !canBuildRoad) { setBuildError('Not enough resources! Need 1🌲 1🧱'); return; }
    if (type === 'settlement' && !canBuildSettlement) { setBuildError('Not enough resources! Need 1🌲 1🧱 1🌾 1🐑'); return; }
    if (type === 'city' && !canBuildCity) { setBuildError('Not enough resources! Need 2🌾 3⛏️'); return; }
    setBuildingMode(prev => prev === type ? null : type);
    setBuildError(null);
  };

  const handleBankTrade = () => {
    const ratios = getTradeRatios(game, game.currentPlayer);
    const credits = RESOURCES.reduce((s, r) => s + Math.floor((tradeOffer[r] || 0) / (ratios[r] || 4)), 0);
    const reqAmt = RESOURCES.reduce((s, r) => s + (tradeRequest[r] || 0), 0);
    if (credits === 0 || reqAmt === 0 || reqAmt > credits) return;
    const player = currentPlayer;
    setGame(prev => {
      const freshRatios = getTradeRatios(prev, prev.currentPlayer);
      const newResources = { ...prev.players[prev.currentPlayer].resources };
      RESOURCES.forEach(r => {
        const ratio = freshRatios[r] || 4;
        const offered = tradeOffer[r] || 0;
        const usedBatches = Math.floor(offered / ratio);
        newResources[r] = (newResources[r] || 0) - usedBatches * ratio;
      });
      RESOURCES.forEach(r => {
        newResources[r] = (newResources[r] || 0) + (tradeRequest[r] || 0);
      });
      const newGame = {
        ...prev,
        players: prev.players.map(p => p.id !== player.id ? p : { ...p, resources: newResources }),
      };
      const giveStr = RESOURCES.filter(r => tradeOffer[r]).map(r => `${tradeOffer[r]}${HEX_ICON[r]}`).join(' ');
      const getStr = RESOURCES.filter(r => tradeRequest[r]).map(r => `${tradeRequest[r]}${HEX_ICON[r]}`).join(' ');
      addLog(newGame, `${player.name} traded ${giveStr} → ${getStr}`);
      return newGame;
    });
    setTradeOffer({}); setTradeRequest({});
    setBankTradeModalOpen(false);
  };

  const handleProposePlayerTrade = () => {
    const totalOff = RESOURCES.reduce((s, r) => s + (playerTradeOffer[r] || 0), 0);
    const totalReq = RESOURCES.reduce((s, r) => s + (playerTradeRequest[r] || 0), 0);
    if (totalOff === 0 || totalReq === 0) return;
    // AI responses are immediate
    const aiResponses: { playerId: number; accepts: boolean; isPending?: boolean }[] = game.players
      .filter(p => !p.isHuman)
      .map(p => {
        const hasAll = RESOURCES.every(r => (p.resources[r] || 0) >= (playerTradeRequest[r] || 0));
        const accepts = hasAll && totalOff > 0;
        return { playerId: p.id, accepts };
      });
    if (multiplayerConfig) {
      // In multiplayer: also broadcast to human opponents via game state
      const humanOpponents = game.players.filter(p => p.isHuman && p.id !== multiplayerConfig.mySlot);
      const humanResponses = humanOpponents.map(p => ({ playerId: p.id, accepts: false, isPending: true }));
      setPlayerTradeResponses([...aiResponses, ...humanResponses]);
      if (humanOpponents.length > 0) {
        const tradeId = `human-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        myPendingHumanTradeIdRef.current = tradeId;
        setGame(prev => ({
          ...prev,
          pendingHumanTrade: {
            tradeId,
            fromPlayer: multiplayerConfig.mySlot,
            offering: { ...playerTradeOffer },
            requesting: { ...playerTradeRequest },
          },
        }));
      }
    } else {
      setPlayerTradeResponses(aiResponses);
    }
  };

  const handleExecutePlayerTrade = (fromPlayerId: number) => {
    const player = currentPlayer;
    setGame(prev => {
      const newPlayers = prev.players.map(p => {
        if (p.id === player.id) {
          const r = { ...p.resources };
          RESOURCES.forEach(res => {
            r[res] = (r[res] || 0) - (playerTradeOffer[res] || 0) + (playerTradeRequest[res] || 0);
          });
          return { ...p, resources: r };
        }
        if (p.id === fromPlayerId) {
          const r = { ...p.resources };
          RESOURCES.forEach(res => {
            r[res] = (r[res] || 0) + (playerTradeOffer[res] || 0) - (playerTradeRequest[res] || 0);
          });
          return { ...p, resources: r };
        }
        return p;
      });
      const newGame = { ...prev, players: newPlayers };
      const offerStr = RESOURCES.filter(r => (playerTradeOffer[r] || 0) > 0).map(r => `${playerTradeOffer[r]}${HEX_ICON[r]}`).join('+');
      const reqStr = RESOURCES.filter(r => (playerTradeRequest[r] || 0) > 0).map(r => `${playerTradeRequest[r]}${HEX_ICON[r]}`).join('+');
      addLog(newGame, `${player.name} traded ${offerStr} with ${prev.players[fromPlayerId].name} for ${reqStr}`);
      return newGame;
    });
    setPlayerTradeOffer({}); setPlayerTradeRequest({}); setPlayerTradeResponses([]);
    setPlayerTradeModalOpen(false);
  };

  // Returns true if the AI is willing to accept the given counter terms
  function aiWillAcceptCounter(
    aiPlayer: Player,
    offering: Partial<Record<Resource, number>>,   // what AI gives
    requesting: Partial<Record<Resource, number>>,  // what AI receives
  ): boolean {
    const totalGive = RESOURCES.reduce((s, r) => s + (offering[r] || 0), 0);
    const totalReceive = RESOURCES.reduce((s, r) => s + (requesting[r] || 0), 0);
    if (totalGive === 0 || totalReceive === 0) return false;
    // AI can't give what it doesn't have
    if (RESOURCES.some(r => (offering[r] || 0) > (aiPlayer.resources[r] || 0))) return false;
    // AI accepts up to 2:1 (giving 2, receiving 1) — generous but not a pushover
    if (totalGive / totalReceive > 2) return false;
    return true;
  }

  const handleStartCounter = () => {
    if (!aiTradeProposal) return;
    setCounterOffering({ ...aiTradeProposal.offering });
    setCounterRequesting({ ...aiTradeProposal.requesting });
    setCounterMode(true);
    setCounterResult(null);
  };

  const handleSendCounter = () => {
    if (!aiTradeProposal) return;
    const aiPlayer = game.players[aiTradeProposal.fromPlayer];
    const accepts = aiWillAcceptCounter(aiPlayer, counterOffering, counterRequesting);
    setCounterResult(accepts ? 'accepted' : 'declined');
  };

  const handleExecuteCounter = () => {
    if (!aiTradeProposal || counterResult !== 'accepted') return;
    const { fromPlayer, pendingState } = aiTradeProposal;
    setAiTradeProposal(null);
    setCounterMode(false);
    setCounterResult(null);
    if (multiplayerConfig && !multiplayerConfig.isHost) {
      // Non-host: apply counter trade and signal host to resume AI turn
      const humanId = multiplayerConfig.mySlot;
      setGame(prev => {
        if (!prev.pendingAiTrade) return prev; // already resolved
        const newPlayers = prev.players.map(p => {
          const res = { ...p.resources };
          if (p.id === fromPlayer) {
            RESOURCES.forEach(r => { res[r] = (res[r] || 0) - (counterOffering[r] || 0) + (counterRequesting[r] || 0); });
          } else if (p.id === humanId) {
            RESOURCES.forEach(r => { res[r] = (res[r] || 0) + (counterOffering[r] || 0) - (counterRequesting[r] || 0); });
          }
          return { ...p, resources: res };
        });
        const aiName = prev.players[fromPlayer].name;
        const giveStr = RESOURCES.filter(r => (counterOffering[r] || 0) > 0).map(r => `${counterOffering[r]}${HEX_ICON[r]}`).join(' ');
        const getStr = RESOURCES.filter(r => (counterRequesting[r] || 0) > 0).map(r => `${counterRequesting[r]}${HEX_ICON[r]}`).join(' ');
        const traded: GameState = { ...prev, players: newPlayers, pendingAiTrade: null, pendingAiTurn: true };
        addLog(traded, `${aiName} accepted counter: gave ${giveStr} for ${getStr}`);
        return traded;
      });
    } else {
      // Host or solo: apply counter and complete AI turn immediately
      setGame(prev => {
        const humanId = multiplayerConfig ? multiplayerConfig.mySlot : (pendingState.players.find(p => p.isHuman)?.id ?? 0);
        const traded: GameState = {
          ...prev,
          pendingAiTrade: null,
          players: prev.players.map(p => {
            const res = { ...p.resources };
            if (p.id === fromPlayer) {
              RESOURCES.forEach(r => { res[r] = (res[r] || 0) - (counterOffering[r] || 0) + (counterRequesting[r] || 0); });
            } else if (p.id === humanId) {
              RESOURCES.forEach(r => { res[r] = (res[r] || 0) + (counterOffering[r] || 0) - (counterRequesting[r] || 0); });
            }
            return { ...p, resources: res };
          }),
        };
        const aiName = prev.players[fromPlayer].name;
        const giveStr = RESOURCES.filter(r => (counterOffering[r] || 0) > 0).map(r => `${counterOffering[r]}${HEX_ICON[r]}`).join(' ');
        const getStr = RESOURCES.filter(r => (counterRequesting[r] || 0) > 0).map(r => `${counterRequesting[r]}${HEX_ICON[r]}`).join(' ');
        addLog(traded, `${aiName} accepted counter: gave ${giveStr} for ${getStr}`);
        const result = aiDoFullTurn(traded);
        aiTurnInProgressRef.current = false;
        return result;
      });
    }
  };

  const handleBackToOriginal = () => {
    setCounterMode(false);
    setCounterResult(null);
  };

  const handleAcceptAiTrade = () => {
    if (!aiTradeProposal) return;
    const { fromPlayer, offering, requesting } = aiTradeProposal;
    setAiTradeProposal(null);
    setCounterMode(false);
    setCounterResult(null);
    if (multiplayerConfig && !multiplayerConfig.isHost) {
      // Non-host: apply trade locally and signal host to resume the AI turn
      const humanId = multiplayerConfig.mySlot;
      setGame(prev => {
        if (!prev.pendingAiTrade) return prev; // already resolved by another player
        const newPlayers = prev.players.map(p => {
          const res = { ...p.resources };
          if (p.id === fromPlayer) {
            (Object.keys(offering) as Resource[]).forEach(r => { res[r] = (res[r] || 0) - (offering[r] || 0); });
            (Object.keys(requesting) as Resource[]).forEach(r => { res[r] = (res[r] || 0) + (requesting[r] || 0); });
          } else if (p.id === humanId) {
            (Object.keys(offering) as Resource[]).forEach(r => { res[r] = (res[r] || 0) + (offering[r] || 0); });
            (Object.keys(requesting) as Resource[]).forEach(r => { res[r] = (res[r] || 0) - (requesting[r] || 0); });
          }
          return { ...p, resources: res };
        });
        const aiName = prev.players[fromPlayer].name;
        const myName = prev.players[humanId].name;
        const giveStr = (Object.keys(offering) as Resource[]).map(r => `${offering[r]}${HEX_ICON[r as Resource]}`).join(' ');
        const getStr = (Object.keys(requesting) as Resource[]).map(r => `${requesting[r]}${HEX_ICON[r as Resource]}`).join(' ');
        const traded: GameState = { ...prev, players: newPlayers, pendingAiTrade: null, pendingAiTurn: true };
        addLog(traded, `${aiName} traded ${giveStr} with ${myName} for ${getStr}`);
        return traded;
      });
    } else {
      // Host or solo: apply trade and immediately complete AI turn
      setGame(prev => {
        const humanId = multiplayerConfig ? multiplayerConfig.mySlot : (prev.players.find(p => p.isHuman)?.id ?? 0);
        const traded: GameState = {
          ...prev,
          pendingAiTrade: null,
          players: prev.players.map(p => {
            const res = { ...p.resources };
            if (p.id === fromPlayer) {
              (Object.keys(offering) as Resource[]).forEach(r => { res[r] = (res[r] || 0) - (offering[r] || 0); });
              (Object.keys(requesting) as Resource[]).forEach(r => { res[r] = (res[r] || 0) + (requesting[r] || 0); });
            } else if (p.id === humanId) {
              (Object.keys(offering) as Resource[]).forEach(r => { res[r] = (res[r] || 0) + (offering[r] || 0); });
              (Object.keys(requesting) as Resource[]).forEach(r => { res[r] = (res[r] || 0) - (requesting[r] || 0); });
            }
            return { ...p, resources: res };
          }),
        };
        const aiName = prev.players[fromPlayer].name;
        const giveStr = (Object.keys(offering) as Resource[]).map(r => `${offering[r]}${HEX_ICON[r as Resource]}`).join(' ');
        const getStr = (Object.keys(requesting) as Resource[]).map(r => `${requesting[r]}${HEX_ICON[r as Resource]}`).join(' ');
        addLog(traded, `${aiName} traded ${giveStr} with you for ${getStr}`);
        const result = aiDoFullTurn(traded);
        aiTurnInProgressRef.current = false;
        return result;
      });
    }
  };

  const handleDeclineAiTrade = () => {
    if (!aiTradeProposal) return;
    const { pendingState } = aiTradeProposal;
    setAiTradeProposal(null);
    setCounterMode(false);
    setCounterResult(null);
    if (multiplayerConfig && !multiplayerConfig.isHost) {
      // Non-host: clear the trade and signal host to resume AI turn without a trade
      setGame(prev => ({
        ...prev,
        pendingAiTrade: null,
        pendingAiTurn: true,
      }));
    } else {
      // Host or solo: resume AI turn immediately
      setGame(() => {
        const result = aiDoFullTurn({ ...pendingState, pendingAiTrade: null });
        aiTurnInProgressRef.current = false;
        return result;
      });
    }
  };

  // Accept an incoming human-to-human trade offer (non-offering player)
  const handleAcceptIncomingHumanTrade = () => {
    if (!incomingHumanTrade || !multiplayerConfig) return;
    const { fromPlayer, offering, requesting } = incomingHumanTrade;
    const mySlot = multiplayerConfig.mySlot;
    setGame(prev => {
      if (!prev.pendingHumanTrade) return prev; // already resolved by another player
      const myPlayer = prev.players[mySlot];
      const canAffordTrade = RESOURCES.every(r => (myPlayer.resources[r] || 0) >= (requesting[r] || 0));
      if (!canAffordTrade) return prev; // can't afford (resources may have changed)
      const newPlayers = prev.players.map(p => {
        const res = { ...p.resources };
        if (p.id === fromPlayer) {
          // Offerer loses what they offered, gains what they wanted
          RESOURCES.forEach(r => { res[r] = (res[r] || 0) - (offering[r] || 0) + (requesting[r] || 0); });
        } else if (p.id === mySlot) {
          // Acceptor gains what was offered, loses what was requested
          RESOURCES.forEach(r => { res[r] = (res[r] || 0) + (offering[r] || 0) - (requesting[r] || 0); });
        }
        return { ...p, resources: res };
      });
      const fromName = prev.players[fromPlayer].name;
      const myName = prev.players[mySlot].name;
      const offerStr = RESOURCES.filter(r => (offering[r] || 0) > 0).map(r => `${offering[r]}${HEX_ICON[r]}`).join(' ');
      const reqStr = RESOURCES.filter(r => (requesting[r] || 0) > 0).map(r => `${requesting[r]}${HEX_ICON[r]}`).join(' ');
      const newGame = { ...prev, players: newPlayers, pendingHumanTrade: null };
      addLog(newGame, `${fromName} traded ${offerStr} with ${myName} for ${reqStr}`);
      return newGame;
    });
    setIncomingHumanTrade(null);
  };

  // Decline an incoming human trade offer (just closes the modal locally)
  const handleDeclineIncomingHumanTrade = () => {
    setIncomingHumanTrade(null);
  };

  const handleBuyDevCard = () => {
    if (!canBuildDevCard) { setBuildError('Need 1🌾 1🐑 1⛏️ to buy a dev card'); return; }
    setGame(prev => {
      if (prev.devCardDeck.length === 0) return prev;
      const buyer = prev.players[prev.currentPlayer];
      if (!canAfford(buyer, BUILD_COSTS.devCard)) return prev;
      const newDeck = [...prev.devCardDeck];
      const card = newDeck.pop()!;
      const newGame = {
        ...prev,
        devCardDeck: newDeck,
        players: prev.players.map(p =>
          p.id !== prev.currentPlayer ? p
            : {
                ...p,
                devCards: [...p.devCards, card],
                resources: {
                  ...p.resources,
                  wheat: (p.resources.wheat || 0) - 1,
                  sheep: (p.resources.sheep || 0) - 1,
                  ore: (p.resources.ore || 0) - 1,
                },
              }
        ),
      };
      addLog(newGame, `${buyer.name} bought a development card`);
      return newGame;
    });
  };

  const handlePlayKnight = () => {
    setGame(prev => {
      const newGame = {
        ...prev,
        players: prev.players.map(p =>
          p.id !== prev.currentPlayer ? p : { ...p, devCards: [...p.devCards] }
        ),
      };
      playKnight(newGame, prev.currentPlayer);
      updateLargestArmy(newGame);
      addLog(newGame, `${prev.players[prev.currentPlayer].name} played a Knight`);
      return newGame;
    });
    setDevCardPlayedThisTurn(true);
    setDevCardMode(null);
    setRobbingMode(true);
  };

  const handlePlayRoadBuilding = () => {
    setGame(prev => {
      const newGame = {
        ...prev,
        players: prev.players.map(p =>
          p.id !== prev.currentPlayer ? p : { ...p, devCards: [...p.devCards] }
        ),
      };
      playRoadBuilding(newGame, prev.currentPlayer);
      addLog(newGame, `${prev.players[prev.currentPlayer].name} played Road Building`);
      return newGame;
    });
    setDevCardPlayedThisTurn(true);
    setDevCardMode(null);
    setRoadBuildingRoadsLeft(2);
    setBuildingMode('road');
  };

  const handlePickYearOfPlentyResource = (r: Resource) => {
    const newPicks = [...yearOfPlentyPicks, r];
    setYearOfPlentyPicks(newPicks);
    if (newPicks.length === 2) {
      setGame(prev => {
        const newGame = {
          ...prev,
          players: prev.players.map(p =>
            p.id !== prev.currentPlayer ? p : { ...p, devCards: [...p.devCards], resources: { ...p.resources } }
          ),
        };
        playYearOfPlenty(newGame, prev.currentPlayer, newPicks[0], newPicks[1]);
        addLog(newGame, `${prev.players[prev.currentPlayer].name} played Year of Plenty → ${HEX_ICON[newPicks[0]]} ${HEX_ICON[newPicks[1]]}`);
        return newGame;
      });
      setDevCardMode(null);
      setDevCardModalOpen(false);
      setYearOfPlentyPicks([]);
      setDevCardPlayedThisTurn(true);
    }
  };

  const handlePlayMonopoly = (r: Resource) => {
    setGame(prev => {
      const newGame = {
        ...prev,
        players: prev.players.map(p => ({ ...p, devCards: [...p.devCards], resources: { ...p.resources } })),
      };
      playMonopoly(newGame, prev.currentPlayer, r);
      addLog(newGame, `${prev.players[prev.currentPlayer].name} played Monopoly on ${r}!`);
      return newGame;
    });
    setDevCardMode(null);
    setDevCardModalOpen(false);
    setDevCardPlayedThisTurn(true);
  };

  const handleMoveRobber = (hexId: string) => {
    setRobbingMode(false);
    const hex = game.board.hexes.find(h => h.id === hexId)!;
    const { cx, cy } = hexCenterPx(hex.q, hex.r);
    // Find adjacent opponents who have resources to steal
    const adjacent = game.players.filter(p => {
      if (p.id === game.currentPlayer) return false;
      if (getTotalResources(p) === 0) return false;
      return game.board.vertices.some(v => {
        if (!v.settlements[p.id.toString()]) return false;
        const dx = v.x - cx, dy = v.y - cy;
        return Math.sqrt(dx * dx + dy * dy) <= HEX_SIZE + 2;
      });
    });
    setGame(prev => {
      const newGame = {
        ...prev,
        board: {
          ...prev.board,
          hexes: prev.board.hexes.map(h => ({ ...h, hasRobber: h.id === hexId })),
        },
        selectedHexForRobber: hex,
      };
      addLog(newGame, `${prev.players[prev.currentPlayer].name} moved the robber`);
      return newGame;
    });
    // Always show the steal UI — even for a single candidate — so the player
    // always gets a clear confirmation prompt. Pass an empty array if nobody
    // is adjacent/has cards so the "nobody to steal from" message is shown.
    setStealCandidates(adjacent);
  };

  const handleSteal = (fromPlayerId: number) => {
    setStealCandidates([]);
    setGame(prev => {
      const fromPlayer = prev.players[fromPlayerId];
      const toPlayer = prev.players[prev.currentPlayer];
      const resources = (['wood', 'brick', 'sheep', 'wheat', 'ore'] as Resource[]).filter(
        r => (fromPlayer.resources[r] || 0) > 0
      );
      if (resources.length === 0) return prev;
      const res = resources[Math.floor(Math.random() * resources.length)];
      const newGame = {
        ...prev,
        players: prev.players.map(p => {
          if (p.id === fromPlayerId) return { ...p, resources: { ...p.resources, [res]: (p.resources[res] || 0) - 1 } };
          if (p.id === prev.currentPlayer) return { ...p, resources: { ...p.resources, [res]: (p.resources[res] || 0) + 1 } };
          return p;
        }),
      };
      addLog(newGame, `${toPlayer.name} stole a resource from ${fromPlayer.name}`);
      return newGame;
    });
  };

  const handleUpgradeCity = (vertexId: string) => {
    if (!canBuildCity) { setBuildError('Not enough resources! Need 2🌾3⛏️'); return; }
    const player = currentPlayer;
    setGame(prev => {
      const newGame = {
        ...prev,
        board: {
          ...prev.board,
          vertices: prev.board.vertices.map(v =>
            v.id !== vertexId ? v
              : { ...v, settlements: { ...v.settlements, [player.id]: 'city' as const } }
          ),
        },
        players: prev.players.map(p =>
          p.id !== player.id ? p : {
            ...p,
            resources: {
              ...p.resources,
              wheat: (p.resources.wheat || 0) - 2,
              ore: (p.resources.ore || 0) - 3,
            },
            pieces: { ...p.pieces, cities: p.pieces.cities - 1, settlements: p.pieces.settlements + 1 },
          }
        ),
      };
      addLog(newGame, `${player.name} upgraded to a city`);
      // Check win condition immediately
      for (const p of newGame.players) p.victoryPoints = calculateVP(p, newGame);
      const w = checkWinCondition(newGame);
      if (w !== null) { newGame.winner = w; newGame.phase = 'gameOver'; }
      return newGame;
    });
    setBuildingMode(null);
  };

  // ── Board pan handlers ─────────────────────────────────────────────────────

  const handlePanStart = useCallback((clientX: number, clientY: number) => {
    panStartRef.current = { x: clientX, y: clientY, vbx: viewBox.x, vby: viewBox.y };
    panMoved.current = false;
    setIsPanning(true);
  }, [viewBox.x, viewBox.y]);

  const handlePanMove = useCallback((clientX: number, clientY: number) => {
    if (!isPanning || !svgRef.current) return;
    const dx = clientX - panStartRef.current.x;
    const dy = clientY - panStartRef.current.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) panMoved.current = true;
    const scale = viewBox.w / svgRef.current.clientWidth;
    const newX = Math.max(TABLE_VB.x, Math.min(TABLE_VB.x + TABLE_VB.w - viewBox.w, panStartRef.current.vbx - dx * scale));
    const newY = Math.max(TABLE_VB.y, Math.min(TABLE_VB.y + TABLE_VB.h - viewBox.h, panStartRef.current.vby - dy * scale));
    setViewBox(vb => ({ ...vb, x: newX, y: newY }));
  }, [isPanning, viewBox.w]);

  const handlePanEnd = useCallback(() => {
    setIsPanning(false);
  }, []);

  const handleZoom = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    if (!svgRef.current) return;
    const zoomFactor = e.deltaY > 0 ? 1.08 : 0.92; // scroll down = zoom out
    setViewBox(vb => {
      const newW = Math.max(MIN_VB_SIZE, Math.min(MAX_VB_SIZE, vb.w * zoomFactor));
      const newH = Math.max(MIN_VB_SIZE, Math.min(MAX_VB_SIZE, vb.h * zoomFactor));
      // Zoom toward cursor position
      const rect = svgRef.current!.getBoundingClientRect();
      const mx = (e.clientX - rect.left) / rect.width;  // 0..1 mouse position
      const my = (e.clientY - rect.top) / rect.height;
      const newX = vb.x + (vb.w - newW) * mx;
      const newY = vb.y + (vb.h - newH) * my;
      // Clamp to table bounds
      const clampedX = Math.max(TABLE_VB.x, Math.min(TABLE_VB.x + TABLE_VB.w - newW, newX));
      const clampedY = Math.max(TABLE_VB.y, Math.min(TABLE_VB.y + TABLE_VB.h - newH, newY));
      return { x: clampedX, y: clampedY, w: newW, h: newH };
    });
  }, []);

  // ── Rendering ────────────────────────────────────────────────────────────────

  const renderBoardDefs = () => (
    <defs>
      {/* Drop shadow for buildings */}
      <filter id="building-shadow" x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="1.5" dy="2" stdDeviation="1.5" floodColor="#000" floodOpacity="0.5" />
      </filter>
      {/* Wood: vertical bark/grain lines */}
      <pattern id="pat-wood" x="0" y="0" width="10" height="12" patternUnits="userSpaceOnUse">
        <line x1="0" y1="0" x2="0" y2="12" stroke="rgba(0,0,0,0.2)" strokeWidth="2.5" />
        <line x1="5" y1="0" x2="5" y2="12" stroke="rgba(255,255,255,0.1)" strokeWidth="1.5" />
      </pattern>
      {/* Brick: staggered mortar grid */}
      <pattern id="pat-brick" x="0" y="0" width="18" height="10" patternUnits="userSpaceOnUse">
        <rect x="0.5" y="0.5" width="17" height="4" fill="none" stroke="rgba(0,0,0,0.28)" strokeWidth="1" />
        <rect x="0.5" y="5.5" width="17" height="4" fill="none" stroke="rgba(0,0,0,0.28)" strokeWidth="1" />
        <line x1="9" y1="0" x2="9" y2="5" stroke="rgba(0,0,0,0.28)" strokeWidth="1" />
        <line x1="0" y1="5" x2="0" y2="10" stroke="rgba(0,0,0,0.28)" strokeWidth="1" />
        <line x1="18" y1="5" x2="18" y2="10" stroke="rgba(0,0,0,0.28)" strokeWidth="1" />
      </pattern>
      {/* Sheep: rolling wavy hills */}
      <pattern id="pat-sheep" x="0" y="0" width="24" height="12" patternUnits="userSpaceOnUse">
        <path d="M0,9 Q6,3 12,9 Q18,15 24,9" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="1.8" />
        <path d="M0,4 Q6,-2 12,4 Q18,10 24,4" fill="none" stroke="rgba(0,0,0,0.1)" strokeWidth="1" />
      </pattern>
      {/* Wheat: vertical stalks with horizontal grain */}
      <pattern id="pat-wheat" x="0" y="0" width="8" height="14" patternUnits="userSpaceOnUse">
        <line x1="4" y1="0" x2="4" y2="14" stroke="rgba(255,255,255,0.22)" strokeWidth="1.8" />
        <line x1="1" y1="5" x2="7" y2="5" stroke="rgba(0,0,0,0.14)" strokeWidth="0.8" />
        <line x1="1" y1="10" x2="7" y2="10" stroke="rgba(0,0,0,0.14)" strokeWidth="0.8" />
      </pattern>
      {/* Ore: diagonal rock fracture lines */}
      <pattern id="pat-ore" x="0" y="0" width="16" height="16" patternUnits="userSpaceOnUse">
        <line x1="0" y1="16" x2="16" y2="0" stroke="rgba(255,255,255,0.18)" strokeWidth="2" />
        <line x1="-8" y1="16" x2="8" y2="0" stroke="rgba(0,0,0,0.15)" strokeWidth="1" />
        <line x1="8" y1="16" x2="24" y2="0" stroke="rgba(0,0,0,0.12)" strokeWidth="1" />
      </pattern>
      {/* Desert: sandy stipple */}
      <pattern id="pat-desert" x="0" y="0" width="12" height="12" patternUnits="userSpaceOnUse">
        <circle cx="3" cy="3" r="1.5" fill="rgba(0,0,0,0.12)" />
        <circle cx="9" cy="9" r="1.2" fill="rgba(0,0,0,0.1)" />
        <circle cx="9" cy="3" r="0.8" fill="rgba(255,255,255,0.12)" />
        <circle cx="3" cy="9" r="0.8" fill="rgba(255,255,255,0.1)" />
      </pattern>
      {/* Gold: diagonal shimmer */}
      <pattern id="pat-gold" x="0" y="0" width="10" height="10" patternUnits="userSpaceOnUse">
        <line x1="0" y1="10" x2="10" y2="0" stroke="rgba(255,255,255,0.25)" strokeWidth="2" />
        <line x1="-5" y1="10" x2="5" y2="0" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
      </pattern>
      {/* Vignette: lighter centre → darker edges for depth */}
      <radialGradient id="hex-vignette" cx="50%" cy="50%" r="75%">
        <stop offset="20%" stopColor="rgba(255,255,255,0.1)" />
        <stop offset="100%" stopColor="rgba(0,0,0,0.38)" />
      </radialGradient>
      {/* Table surface — old pub wood base color */}
      <radialGradient id="table-surface-grad" cx="50%" cy="50%" r="75%">
        <stop offset="0%" stopColor="#5a3818" />
        <stop offset="50%" stopColor="#4a2c10" />
        <stop offset="100%" stopColor="#3a1e08" />
      </radialGradient>
      {/* Wood plank grain pattern */}
      <pattern id="table-wood-grain" x="0" y="0" width="1240" height="80" patternUnits="userSpaceOnUse">
        {/* Plank lines — horizontal boards */}
        <rect width="1240" height="80" fill="transparent" />
        <line x1="0" y1="0" x2="1240" y2="0" stroke="rgba(0,0,0,0.25)" strokeWidth="2" />
        <line x1="0" y1="79" x2="1240" y2="79" stroke="rgba(0,0,0,0.15)" strokeWidth="1" />
        {/* Wood grain within each plank */}
        <line x1="0" y1="18" x2="1240" y2="16" stroke="rgba(0,0,0,0.06)" strokeWidth="1.5" />
        <line x1="0" y1="35" x2="1240" y2="37" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
        <line x1="0" y1="52" x2="1240" y2="50" stroke="rgba(0,0,0,0.05)" strokeWidth="1" />
        <line x1="0" y1="65" x2="1240" y2="66" stroke="rgba(255,255,255,0.02)" strokeWidth="0.8" />
        {/* Knot holes */}
        <circle cx="280" cy="40" r="6" fill="rgba(0,0,0,0.12)" />
        <circle cx="280" cy="40" r="3" fill="rgba(0,0,0,0.08)" />
        <circle cx="820" cy="25" r="4" fill="rgba(0,0,0,0.1)" />
        <circle cx="1100" cy="55" r="5" fill="rgba(0,0,0,0.1)" />
      </pattern>
      {/* Table surface — combined as a filter/composite */}
      <pattern id="table-surface" x="-620" y="-620" width="1240" height="1240" patternUnits="userSpaceOnUse">
        <rect width="1240" height="1240" fill="url(#table-surface-grad)" />
        <rect width="1240" height="1240" fill="url(#table-wood-grain)" />
      </pattern>
      {/* Cigar wrapper texture */}
      <pattern id="cigar-wrap" x="0" y="0" width="6" height="14" patternUnits="userSpaceOnUse">
        <line x1="0" y1="0" x2="0" y2="14" stroke="rgba(0,0,0,0.08)" strokeWidth="1" />
        <line x1="3" y1="0" x2="3" y2="14" stroke="rgba(255,255,255,0.04)" strokeWidth="0.5" />
      </pattern>
    </defs>
  );

  const renderHex = (hex: Hex) => {
    const cx = HEX_SIZE * (Math.sqrt(3) * hex.q + Math.sqrt(3) / 2 * hex.r);
    const cy = HEX_SIZE * 1.5 * hex.r;
    const pts: string[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3 + Math.PI / 6;
      pts.push(`${cx + HEX_SIZE * Math.cos(a)},${cy + HEX_SIZE * Math.sin(a)}`);
    }

    const hasNumber = Boolean(hex.number);
    const isHighNumber = hex.number === 6 || hex.number === 8;
    const numColor = isHighNumber ? '#c0392b' : '#1a1a2e';
    const dots = hex.number ? (PROBABILITY_DOTS[hex.number] ?? 0) : 0;
    const dotSpacing = 6;
    const totalDotWidth = (dots - 1) * dotSpacing;

    // Illustrated emoji — position depends on whether there's a number token
    const tileEmojis = HEX_TILE_EMOJI[hex.resource];
    const emojiY = hasNumber ? cy - 22 : cy + 4;

    return (
      <g key={hex.id}>
        <polygon points={pts.join(' ')} fill={HEX_COLOR[hex.resource]} stroke="#3a200a" strokeWidth="3" className="hex" />
        {/* Resource-specific texture pattern */}
        <polygon points={pts.join(' ')} fill={`url(#pat-${hex.resource})`} stroke="none" />
        {/* Vignette: subtle depth (lighter centre, darker edges) */}
        <polygon points={pts.join(' ')} fill="url(#hex-vignette)" stroke="none" />

        {/* Tile art — emoji spread across the hex, no text labels */}
        {tileEmojis.length === 1 && (
          <text x={cx} y={emojiY + 10} textAnchor="middle" fontSize="28" style={{ userSelect: 'none' }}>
            {tileEmojis[0]}
          </text>
        )}
        {tileEmojis.length === 2 && (
          <>
            <text x={cx - 13} y={emojiY + 8} textAnchor="middle" fontSize="22" style={{ userSelect: 'none' }}>{tileEmojis[0]}</text>
            <text x={cx + 13} y={emojiY + 8} textAnchor="middle" fontSize="22" style={{ userSelect: 'none' }}>{tileEmojis[1]}</text>
          </>
        )}
        {tileEmojis.length === 3 && (
          <>
            <text x={cx - 18} y={emojiY + 4} textAnchor="middle" fontSize="18" style={{ userSelect: 'none' }}>{tileEmojis[0]}</text>
            <text x={cx}      y={emojiY - 4} textAnchor="middle" fontSize="18" style={{ userSelect: 'none' }}>{tileEmojis[1]}</text>
            <text x={cx + 18} y={emojiY + 4} textAnchor="middle" fontSize="18" style={{ userSelect: 'none' }}>{tileEmojis[2]}</text>
          </>
        )}

        {/* Number token with probability dots */}
        {hasNumber && (
          <g>
            {/* Token background circle */}
            <circle cx={cx} cy={cy + 14} r={28} fill={hex.hasRobber ? '#333' : '#f5e6c8'} stroke="#8b6914" strokeWidth="2" />
            {/* The number */}
            <text x={cx} y={cy + 11} textAnchor="middle" fill={numColor} fontSize={isHighNumber ? '24' : '22'} fontWeight="bold" style={{ userSelect: 'none' }}>
              {hex.number}
            </text>
            {/* Probability dots below the number */}
            {Array.from({ length: dots }).map((_, i) => (
              <circle
                key={i}
                cx={cx - totalDotWidth / 2 + i * dotSpacing}
                cy={cy + 25}
                r={2.5}
                fill={isHighNumber ? '#c0392b' : '#1a1a2e'}
              />
            ))}
          </g>
        )}

        {/* Robber on desert (no number token) */}
        {hex.hasRobber && !hasNumber && (
          <text x={cx} y={cy + 12} textAnchor="middle" fontSize="22" style={{ userSelect: 'none' }}>☠️</text>
        )}
      </g>
    );
  };

  const renderPorts = () =>
    game.board.ports.map(port => {
      const { x1, y1, x2, y2, ox, oy } = portPixels(port);
      const icon = PORT_ICON[port.resource] ?? '⚓';
      const label = `${port.ratio}:1`;
      return (
        <g key={port.id}>
          {/* Pier lines from vertices to dock */}
          <line x1={x1} y1={y1} x2={ox} y2={oy} stroke="#8b6914" strokeWidth="3" strokeDasharray="5,3" opacity={0.8} />
          <line x1={x2} y1={y2} x2={ox} y2={oy} stroke="#8b6914" strokeWidth="3" strokeDasharray="5,3" opacity={0.8} />
          {/* Dock circle */}
          <circle cx={ox} cy={oy} r={19} fill="#1a3a5c" stroke="#c8a228" strokeWidth="2" />
          {/* Icon */}
          <text x={ox} y={oy - 3} textAnchor="middle" fontSize="13" style={{ userSelect: 'none' }}>{icon}</text>
          {/* Ratio label */}
          <text x={ox} y={oy + 12} textAnchor="middle" fontSize="9" fill="#ffd700" fontWeight="bold" style={{ userSelect: 'none' }}>{label}</text>
        </g>
      );
    });

  const renderSettlements = () =>
    game.board.vertices.flatMap(vertex =>
      Object.entries(vertex.settlements).filter(([, t]) => t).map(([pid, type]) => {
        const p = game.players[parseInt(pid)];
        const cx = vertex.x, cy = vertex.y;
        const key = `${vertex.id}-${pid}`;

        if (type === 'city') {
          // Castle: wide rectangular walls + 3 battlements (merlons) across the top
          const wx = cx - 12, wy = cy - 5;  // wall top-left
          const ww = 24, wh = 14;           // wall size
          const mh = 6, mw = 5;             // merlon height & width
          // 3 merlons evenly spaced across the wall top
          const mPositions = [wx + 2, wx + 9, wx + 17];
          return (
            <g key={key} filter="url(#building-shadow)">
              {/* Main wall */}
              <rect x={wx} y={wy} width={ww} height={wh}
                fill={p.color} stroke="#000" strokeWidth="1.5" />
              {/* Wall highlight (top) */}
              <rect x={wx} y={wy} width={ww} height={3}
                fill="rgba(255,255,255,0.25)" />
              {/* Wall shadow (bottom) */}
              <rect x={wx} y={wy + wh - 4} width={ww} height={4}
                fill="rgba(0,0,0,0.3)" />
              {/* Battlements */}
              {mPositions.map((mx, i) => (
                <g key={i}>
                  <rect x={mx} y={wy - mh} width={mw} height={mh}
                    fill={p.color} stroke="#000" strokeWidth="1.5" />
                  {/* Merlon highlight */}
                  <rect x={mx} y={wy - mh} width={mw} height={2}
                    fill="rgba(255,255,255,0.3)" />
                </g>
              ))}
              {/* Arrow-slit window */}
              <rect x={cx - 1} y={wy + 3} width={2} height={5}
                fill="rgba(0,0,0,0.45)" />
            </g>
          );
        }

        // Settlement: realistic wooden game piece — larger, 3D, with wood texture
        const size = 1.4; // scale factor
        const bx = cx - 10 * size, by = cy - 5 * size;
        const bw = 20 * size, bh = 13 * size;
        const roofPeak = by - 11 * size;
        const roofOverhang = 3 * size;
        // Unique gradient IDs per settlement
        const wallGradId = `wall-${key}`;
        const roofGradId = `roof-${key}`;
        return (
          <g key={key} filter="url(#building-shadow)">
            <defs>
              {/* Wall gradient — wooden face with light from upper-left */}
              <linearGradient id={wallGradId} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={p.color} stopOpacity="1" />
                <stop offset="40%" stopColor={p.color} stopOpacity="0.95" />
                <stop offset="100%" stopColor="rgba(0,0,0,0.25)" stopOpacity="1" />
              </linearGradient>
              {/* Roof gradient — lit left, shadowed right */}
              <linearGradient id={roofGradId} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor={p.color} stopOpacity="1" />
                <stop offset="50%" stopColor={p.color} stopOpacity="0.9" />
                <stop offset="100%" stopColor="rgba(0,0,0,0.3)" stopOpacity="1" />
              </linearGradient>
            </defs>
            {/* Base/platform — gives grounding */}
            <rect x={bx - 1} y={by + bh - 1} width={bw + 2} height={3 * size}
              rx={1} fill="rgba(0,0,0,0.35)" />
            {/* Main wall body */}
            <rect x={bx} y={by} width={bw} height={bh}
              rx={1.2} fill={`url(#${wallGradId})`} stroke="#000" strokeWidth="1.8" />
            {/* Wood grain lines on wall */}
            <line x1={bx + 2} y1={by + 3 * size} x2={bx + bw - 2} y2={by + 3 * size}
              stroke="rgba(0,0,0,0.12)" strokeWidth="0.6" />
            <line x1={bx + 2} y1={by + 7 * size} x2={bx + bw - 2} y2={by + 7 * size}
              stroke="rgba(0,0,0,0.12)" strokeWidth="0.6" />
            <line x1={bx + 2} y1={by + 10 * size} x2={bx + bw - 2} y2={by + 10 * size}
              stroke="rgba(0,0,0,0.08)" strokeWidth="0.5" />
            {/* Wall highlight (top edge bevel) */}
            <rect x={bx + 0.5} y={by + 0.5} width={bw - 1} height={2.5}
              rx={1} fill="rgba(255,255,255,0.25)" />
            {/* Wall shadow (bottom edge) */}
            <rect x={bx} y={by + bh - 3} width={bw} height={3}
              fill="rgba(0,0,0,0.2)" />
            {/* Door — recessed look */}
            <rect x={cx - 3 * size} y={by + bh - 7 * size} width={6 * size} height={7 * size}
              rx={0.8} fill="rgba(0,0,0,0.3)" stroke="rgba(0,0,0,0.15)" strokeWidth="0.5" />
            {/* Door highlight */}
            <rect x={cx - 2.5 * size} y={by + bh - 6.5 * size} width={2 * size} height={6 * size}
              fill="rgba(255,255,255,0.06)" />
            {/* Roof — full triangle, filled with gradient */}
            <polygon
              points={`${bx - roofOverhang},${by} ${cx},${roofPeak} ${bx + bw + roofOverhang},${by}`}
              fill={`url(#${roofGradId})`} stroke="#000" strokeWidth="1.8"
              strokeLinejoin="round" />
            {/* Roof left highlight */}
            <polygon
              points={`${bx - roofOverhang},${by} ${cx},${roofPeak} ${cx},${by}`}
              fill="rgba(255,255,255,0.2)" stroke="none" />
            {/* Roof right shadow */}
            <polygon
              points={`${cx},${roofPeak} ${bx + bw + roofOverhang},${by} ${cx},${by}`}
              fill="rgba(0,0,0,0.15)" stroke="none" />
            {/* Roof ridge highlight */}
            <line x1={cx} y1={roofPeak} x2={cx} y2={by}
              stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
            {/* Chimney */}
            <rect x={cx + 4 * size} y={roofPeak + 3 * size} width={3 * size} height={5 * size}
              fill={p.color} stroke="#000" strokeWidth="1" />
            <rect x={cx + 4 * size} y={roofPeak + 3 * size} width={3 * size} height={1.5}
              fill="rgba(255,255,255,0.2)" />
          </g>
        );
      })
    );

  const renderRoads = () =>
    game.board.edges.flatMap(edge =>
      Object.entries(edge.roads).filter(([, t]) => t).map(([pid]) => {
        const p = game.players[parseInt(pid)];
        const x1 = edge.x1, y1 = edge.y1, x2 = edge.x2, y2 = edge.y2;
        const roadGradId = `road-${edge.id}-${pid}`;
        // Calculate road angle for perpendicular offset (3D thickness)
        const dx = x2 - x1, dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy);
        // Perpendicular unit vector (for width offset)
        const px = -dy / len, py = dx / len;
        const w = 5; // half-width of road plank
        const t = 2; // 3D thickness offset
        // Four corners of the road plank (top face)
        const topFace = `${x1 + px * w},${y1 + py * w} ${x2 + px * w},${y2 + py * w} ${x2 - px * w},${y2 - py * w} ${x1 - px * w},${y1 - py * w}`;
        // Side face (3D depth) — offset downward-right for perspective
        const sideFace = `${x1 - px * w},${y1 - py * w} ${x2 - px * w},${y2 - py * w} ${x2 - px * w + t},${y2 - py * w + t} ${x1 - px * w + t},${y1 - py * w + t}`;
        // Bottom edge face
        const bottomFace = `${x2 - px * w},${y2 - py * w} ${x2 + px * w},${y2 + py * w} ${x2 + px * w + t},${y2 + py * w + t} ${x2 - px * w + t},${y2 - py * w + t}`;
        return (
          <g key={`${edge.id}-${pid}`} filter="url(#building-shadow)">
            <defs>
              <linearGradient id={roadGradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={p.color} stopOpacity="1" />
                <stop offset="100%" stopColor={p.color} stopOpacity="0.7" />
              </linearGradient>
            </defs>
            {/* Side face — darker for 3D depth */}
            <polygon points={sideFace}
              fill="rgba(0,0,0,0.4)" stroke="#000" strokeWidth="0.5" />
            {/* Bottom edge face */}
            <polygon points={bottomFace}
              fill="rgba(0,0,0,0.3)" stroke="#000" strokeWidth="0.5" />
            {/* Top face — main road plank */}
            <polygon points={topFace}
              fill={`url(#${roadGradId})`} stroke="#000" strokeWidth="1.5"
              strokeLinejoin="round" />
            {/* Wood grain lines along the plank */}
            <line x1={x1 + px * 2} y1={y1 + py * 2} x2={x2 + px * 2} y2={y2 + py * 2}
              stroke="rgba(255,255,255,0.15)" strokeWidth="0.8" />
            <line x1={x1 - px * 2} y1={y1 - py * 2} x2={x2 - px * 2} y2={y2 - py * 2}
              stroke="rgba(0,0,0,0.15)" strokeWidth="0.8" />
            {/* Highlight edge — top/left lit side */}
            <line x1={x1 + px * w} y1={y1 + py * w} x2={x2 + px * w} y2={y2 + py * w}
              stroke="rgba(255,255,255,0.25)" strokeWidth="1" strokeLinecap="round" />
          </g>
        );
      })
    );

  const renderBuildableSpots = () => {
    // Helper: render a road buildable spot with large hit target
    const roadSpot = (e: Edge, handler: (id: string) => void) => {
      // Compute midpoint and perpendicular for a wider invisible hit rect
      const mx = (e.x1 + e.x2) / 2, my = (e.y1 + e.y2) / 2;
      const dx = e.x2 - e.x1, dy = e.y2 - e.y1;
      const len = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;
      return (
        <g key={`spot-${e.id}`}>
          {/* Invisible large hit area */}
          <rect className="buildable-spot"
            x={mx - len / 2 - 4} y={my - 14} width={len + 8} height={28}
            transform={`rotate(${angle},${mx},${my})`}
            fill="transparent" style={{ cursor: 'pointer' }}
            onClick={ev => { ev.stopPropagation(); handler(e.id); }}
            onPointerDown={ev => ev.stopPropagation()} />
          {/* Visible road highlight */}
          <line className="buildable-spot"
            x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
            stroke="rgba(255,255,255,0.55)" strokeWidth="12" strokeLinecap="round"
            style={{ cursor: 'pointer', pointerEvents: 'none' }} />
        </g>
      );
    };

    // Helper: settlement/city circle spot with large hit target
    const circleSpot = (v: Vertex, r: number, fill: string, stroke: string, handler: (id: string) => void) => (
      <circle key={`spot-${v.id}`} className="buildable-spot"
        cx={v.x} cy={v.y} r={r}
        fill={fill} stroke={stroke} strokeWidth="3"
        style={{ cursor: 'pointer' }}
        onClick={e => { e.stopPropagation(); handler(v.id); }}
        onPointerDown={e => e.stopPropagation()} />
    );

    // Setup phase — auto-show spots for the human (my turn only in multiplayer)
    if (isSetup && isMyTurn) {
      if (game.setupStep === 'settlement') {
        return getValidSettlementVertices(game).map(v =>
          circleSpot(v, 16, 'rgba(255,255,255,0.25)', '#27ae60', handlePlaceSettlement)
        );
      }
      return getValidRoadEdgesSetup(game).map(e => roadSpot(e, handlePlaceRoad));
    }

    // Playing phase manual build mode
    if (!buildingMode || !isMyTurn || isSetup) return null;

    if (buildingMode === 'settlement') {
      return getValidSettlementVertices(game).map(v =>
        circleSpot(v, 16, 'rgba(255,255,255,0.25)', '#27ae60', handlePlaceSettlementPlaying)
      );
    }
    if (buildingMode === 'road') {
      return getValidRoadEdges(game).map(e => roadSpot(e, handlePlaceRoadPlaying));
    }
    if (buildingMode === 'city') {
      const cityTargets = game.board.vertices.filter(
        v => v.settlements[game.currentPlayer.toString()] === 'settlement'
      );
      return cityTargets.map(v =>
        circleSpot(v, 18, 'rgba(255,215,0,0.35)', '#f39c12', handleUpgradeCity)
      );
    }
    return null;
  };

  const renderRobberTargets = () => {
    if (!robbingMode || !isMyTurn) return null;
    return game.board.hexes
      .filter(h => !h.hasRobber)
      .map(hex => {
        const pts: string[] = [];
        const { cx, cy } = hexCenterPx(hex.q, hex.r);
        for (let i = 0; i < 6; i++) {
          const a = (i * Math.PI) / 3 + Math.PI / 6;
          pts.push(`${cx + HEX_SIZE * Math.cos(a)},${cy + HEX_SIZE * Math.sin(a)}`);
        }
        return (
          <polygon key={`robber-${hex.id}`} className="buildable-spot" points={pts.join(' ')}
            fill="rgba(180,0,0,0.22)" stroke="#e74c3c" strokeWidth="2"
            style={{ cursor: 'pointer' }}
            onClick={e => { e.stopPropagation(); handleMoveRobber(hex.id); }}
            onPointerDown={e => e.stopPropagation()} />
        );
      });
  };

  const getDisplayVP = (p: typeof currentPlayer) => calculateVP(p, game);

  // ── Piece piles around the table ──────────────────────────────────────────
  const PILE_CORNERS = [
    { x: -520, y: -520 }, // Player 0 (red) — top-left
    { x: 340, y: -520 },  // Player 1 (blue) — top-right
    { x: -520, y: 370 },  // Player 2 (white) — bottom-left
    { x: 340, y: 370 },   // Player 3 (orange) — bottom-right
  ];

  const renderTableSettlement = (color: string, x: number, y: number, idx: number) => {
    // Same realistic style as on-board settlements, at 1.2x scale
    const size = 1.2;
    const bw = 20 * size, bh = 13 * size;
    const bx = x - bw / 2, by = y - bh / 2;
    const roofPeak = by - 11 * size;
    const roofOverhang = 3 * size;
    const wGradId = `tw-${idx}`, rGradId = `tr-${idx}`;
    return (
      <g key={`ts-${idx}`} filter="url(#building-shadow)">
        <defs>
          <linearGradient id={wGradId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={color} /><stop offset="100%" stopColor="rgba(0,0,0,0.25)" />
          </linearGradient>
          <linearGradient id={rGradId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={color} /><stop offset="100%" stopColor="rgba(0,0,0,0.3)" />
          </linearGradient>
        </defs>
        <rect x={bx - 1} y={by + bh - 1} width={bw + 2} height={3 * size} rx={1} fill="rgba(0,0,0,0.35)" />
        <rect x={bx} y={by} width={bw} height={bh} rx={1.2} fill={`url(#${wGradId})`} stroke="#000" strokeWidth="1.8" />
        <line x1={bx + 2} y1={by + 3 * size} x2={bx + bw - 2} y2={by + 3 * size} stroke="rgba(0,0,0,0.12)" strokeWidth="0.6" />
        <line x1={bx + 2} y1={by + 7 * size} x2={bx + bw - 2} y2={by + 7 * size} stroke="rgba(0,0,0,0.12)" strokeWidth="0.6" />
        <rect x={bx + 0.5} y={by + 0.5} width={bw - 1} height={2.5} rx={1} fill="rgba(255,255,255,0.25)" />
        <rect x={bx} y={by + bh - 3} width={bw} height={3} fill="rgba(0,0,0,0.2)" />
        <rect x={x - 3 * size} y={by + bh - 7 * size} width={6 * size} height={7 * size} rx={0.8} fill="rgba(0,0,0,0.3)" />
        <polygon points={`${bx - roofOverhang},${by} ${x},${roofPeak} ${bx + bw + roofOverhang},${by}`}
          fill={`url(#${rGradId})`} stroke="#000" strokeWidth="1.8" strokeLinejoin="round" />
        <polygon points={`${bx - roofOverhang},${by} ${x},${roofPeak} ${x},${by}`} fill="rgba(255,255,255,0.2)" />
        <polygon points={`${x},${roofPeak} ${bx + bw + roofOverhang},${by} ${x},${by}`} fill="rgba(0,0,0,0.15)" />
        <line x1={x} y1={roofPeak} x2={x} y2={by} stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
        <rect x={x + 4 * size} y={roofPeak + 3 * size} width={3 * size} height={5 * size} fill={color} stroke="#000" strokeWidth="1" />
      </g>
    );
  };

  const renderTableCity = (color: string, x: number, y: number, idx: number) => {
    const wx = x - 14, wy = y - 7, ww = 28, wh = 16;
    const mw = 6, mh = 7;
    const mPositions = [wx + 2, wx + 11, wx + 20];
    return (
      <g key={`tc-${idx}`} filter="url(#building-shadow)">
        <rect x={wx - 1} y={wy + wh - 1} width={ww + 2} height={3} rx={1} fill="rgba(0,0,0,0.35)" />
        <rect x={wx} y={wy} width={ww} height={wh} fill={color} stroke="#000" strokeWidth="1.5" />
        <rect x={wx} y={wy} width={ww} height={3} fill="rgba(255,255,255,0.25)" />
        <rect x={wx} y={wy + wh - 4} width={ww} height={4} fill="rgba(0,0,0,0.3)" />
        {mPositions.map((mx, i) => (
          <g key={i}>
            <rect x={mx} y={wy - mh} width={mw} height={mh} fill={color} stroke="#000" strokeWidth="1.2" />
            <rect x={mx} y={wy - mh} width={mw} height={2} fill="rgba(255,255,255,0.3)" />
          </g>
        ))}
        <rect x={x - 1.5} y={wy + 3} width={3} height={6} fill="rgba(0,0,0,0.45)" />
      </g>
    );
  };

  const renderTableRoad = (color: string, x: number, y: number, idx: number) => {
    // 3D plank style matching on-board roads
    const len = 28, hw = 4, t = 2.5;
    const gradId = `trd-${idx}`;
    return (
      <g key={`trd-${idx}`} filter="url(#building-shadow)">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} /><stop offset="100%" stopColor={color} stopOpacity="0.7" />
          </linearGradient>
        </defs>
        {/* Side face for 3D depth */}
        <rect x={x - len / 2} y={y + hw} width={len} height={t}
          rx={1} fill="rgba(0,0,0,0.35)" stroke="#000" strokeWidth="0.5" />
        {/* Top face */}
        <rect x={x - len / 2} y={y - hw} width={len} height={hw * 2}
          rx={1.5} fill={`url(#${gradId})`} stroke="#000" strokeWidth="1.2" />
        {/* Wood grain */}
        <line x1={x - len / 2 + 2} y1={y - 1} x2={x + len / 2 - 2} y2={y - 1}
          stroke="rgba(255,255,255,0.15)" strokeWidth="0.8" />
        <line x1={x - len / 2 + 2} y1={y + 2} x2={x + len / 2 - 2} y2={y + 2}
          stroke="rgba(0,0,0,0.12)" strokeWidth="0.8" />
        {/* Top highlight */}
        <rect x={x - len / 2} y={y - hw} width={len} height={1.8}
          rx={1.5} fill="rgba(255,255,255,0.22)" />
      </g>
    );
  };

  const renderWoodenCup = (x: number, y: number) => {
    // Human-sized wooden mug — proportional to the game pieces on the table
    const s = 10.5; // scale factor — 3x human-sized
    return (
      <g key="wooden-cup">
        {/* Cup body — tapered */}
        <path d={`M${x - 10 * s / 2},${y - 10 * s / 2} L${x - 12 * s / 2},${y + 18 * s / 2} Q${x},${y + 24 * s / 2} ${x + 12 * s / 2},${y + 18 * s / 2} L${x + 10 * s / 2},${y - 10 * s / 2} Z`}
          fill="#6b3a10" stroke="#3a1e08" strokeWidth="2" />
        {/* Wood grain lines */}
        <line x1={x - 11 * s / 2} y1={y - 2 * s / 2} x2={x + 11 * s / 2} y2={y - 2 * s / 2} stroke="rgba(0,0,0,0.15)" strokeWidth="1.2" />
        <line x1={x - 11.5 * s / 2} y1={y + 6 * s / 2} x2={x + 11.5 * s / 2} y2={y + 6 * s / 2} stroke="rgba(0,0,0,0.12)" strokeWidth="1" />
        <line x1={x - 12 * s / 2} y1={y + 14 * s / 2} x2={x + 12 * s / 2} y2={y + 14 * s / 2} stroke="rgba(0,0,0,0.1)" strokeWidth="0.8" />
        <line x1={x - 10.5 * s / 2} y1={y - 6 * s / 2} x2={x + 10.5 * s / 2} y2={y - 6 * s / 2} stroke="rgba(255,255,255,0.08)" strokeWidth="0.8" />
        {/* Highlight on left side */}
        <path d={`M${x - 9 * s / 2},${y - 8 * s / 2} L${x - 11 * s / 2},${y + 16 * s / 2} Q${x - 6 * s / 2},${y + 10 * s / 2} ${x - 6 * s / 2},${y - 8 * s / 2} Z`}
          fill="rgba(255,255,255,0.12)" />
        {/* Handle — right side */}
        <path d={`M${x + 10 * s / 2},${y - 4 * s / 2} Q${x + 20 * s / 2},${y} ${x + 18 * s / 2},${y + 10 * s / 2} Q${x + 16 * s / 2},${y + 16 * s / 2} ${x + 11 * s / 2},${y + 12 * s / 2}`}
          fill="none" stroke="#5a2e0a" strokeWidth="4" strokeLinecap="round" />
        <path d={`M${x + 10 * s / 2},${y - 4 * s / 2} Q${x + 20 * s / 2},${y} ${x + 18 * s / 2},${y + 10 * s / 2} Q${x + 16 * s / 2},${y + 16 * s / 2} ${x + 11 * s / 2},${y + 12 * s / 2}`}
          fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="1.5" strokeLinecap="round" />
        {/* Dark interior at top */}
        <ellipse cx={x} cy={y - 10 * s / 2} rx={10 * s / 2} ry={5 * s / 2} fill="#1a0e05" stroke="#3a1e08" strokeWidth="1.5" />
        {/* Liquid inside — dark ale */}
        <ellipse cx={x} cy={y - 9.5 * s / 2} rx={8.5 * s / 2} ry={4 * s / 2} fill="#3a1a08" />
        {/* Foam on top */}
        <ellipse cx={x} cy={y - 10 * s / 2} rx={7 * s / 2} ry={2.5 * s / 2} fill="rgba(245,235,200,0.35)" />
        {/* Rim highlight */}
        <ellipse cx={x} cy={y - 10 * s / 2} rx={10 * s / 2} ry={5 * s / 2} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
        {/* Metal bands */}
        <path d={`M${x - 11.5 * s / 2},${y + 2 * s / 2} Q${x},${y + 4 * s / 2} ${x + 11.5 * s / 2},${y + 2 * s / 2}`}
          fill="none" stroke="#9a8a6a" strokeWidth="2.5" />
        <path d={`M${x - 12 * s / 2},${y + 12 * s / 2} Q${x},${y + 14 * s / 2} ${x + 12 * s / 2},${y + 12 * s / 2}`}
          fill="none" stroke="#9a8a6a" strokeWidth="2.5" />
        {/* Band highlights */}
        <path d={`M${x - 11.5 * s / 2},${y + 2 * s / 2} Q${x},${y + 4 * s / 2} ${x + 11.5 * s / 2},${y + 2 * s / 2}`}
          fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="0.8" />
      </g>
    );
  };

  const renderCigar = (x: number, y: number) => (
    <g key="cigar" transform={`translate(${x},${y}) rotate(-12) scale(2)`}>
      {/* Shadow on table */}
      <ellipse cx="2" cy="6" rx="52" ry="5" fill="rgba(0,0,0,0.25)" />
      {/* Cigar body — long tapered cylinder */}
      <rect x="-45" y="-7" width="90" height="14" rx="5" fill="#7a5230" stroke="#4a3018" strokeWidth="1.5" />
      {/* Darker wrapper texture */}
      <rect x="-45" y="-7" width="90" height="14" rx="5" fill="url(#cigar-wrap)" />
      {/* Highlight along top edge */}
      <rect x="-44" y="-6.5" width="88" height="4" rx="3" fill="rgba(255,255,255,0.12)" />
      {/* Shadow along bottom */}
      <rect x="-44" y="3" width="88" height="4" rx="3" fill="rgba(0,0,0,0.15)" />
      {/* Band — gold ring near the end you hold */}
      <rect x="-30" y="-8.5" width="14" height="17" rx="3" fill="#c8960c" stroke="#8a6a08" strokeWidth="1" />
      <rect x="-30" y="-8.5" width="14" height="4" rx="3" fill="rgba(255,255,255,0.2)" />
      <rect x="-28" y="-5" width="10" height="11" rx="2" fill="none" stroke="#ffd700" strokeWidth="0.8" />
      {/* Ash tip — right end */}
      <rect x="40" y="-6" width="12" height="12" rx="4" fill="#b0a898" stroke="#888" strokeWidth="0.8" />
      <rect x="40" y="-6" width="12" height="3" rx="2" fill="rgba(255,255,255,0.2)" />
      {/* Ember glow at tip */}
      <rect x="48" y="-4.5" width="6" height="9" rx="3" fill="#e65c00" opacity="0.7" />
      <rect x="49" y="-3" width="4" height="6" rx="2" fill="#ff8c00" opacity="0.5" />
      {/* Smoke wisps — rising from the lit end */}
      <path d="M54,-6 Q58,-18 52,-28 Q48,-36 54,-48" fill="none" stroke="rgba(180,180,180,0.3)" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M52,-4 Q60,-14 55,-24 Q50,-32 58,-44 Q64,-52 58,-62" fill="none" stroke="rgba(160,160,160,0.2)" strokeWidth="2" strokeLinecap="round" />
      <path d="M56,-8 Q62,-20 58,-32 Q54,-40 60,-52" fill="none" stroke="rgba(200,200,200,0.15)" strokeWidth="3" strokeLinecap="round" />
    </g>
  );

  const renderPolaroid = (x: number, y: number) => {
    // Polaroid photo of a black cat, tilted slightly left
    const pw = 70, ph = 85; // polaroid dimensions
    const border = 6; // white border
    const bottomBorder = 18; // thicker bottom for polaroid style
    return (
      <g key="polaroid" transform={`translate(${x},${y}) rotate(-8)`}>
        {/* Shadow on table */}
        <rect x={-pw / 2 + 4} y={-ph / 2 + 6} width={pw} height={ph} rx={2}
          fill="rgba(0,0,0,0.35)" />
        {/* White polaroid frame */}
        <rect x={-pw / 2} y={-ph / 2} width={pw} height={ph} rx={1.5}
          fill="#f5f0e8" stroke="#d0c8b8" strokeWidth="0.8" />
        {/* Slight aging/yellowing */}
        <rect x={-pw / 2} y={-ph / 2} width={pw} height={ph} rx={1.5}
          fill="rgba(200,180,120,0.06)" />
        {/* Photo area — sunny sky background */}
        <rect x={-pw / 2 + border} y={-ph / 2 + border} width={pw - border * 2} height={ph - border - bottomBorder}
          fill="#7ab8d4" rx={1} />
        {/* Lighter sky at top */}
        <rect x={-pw / 2 + border} y={-ph / 2 + border} width={pw - border * 2} height={20}
          fill="#a8d8ea" rx={1} />
        {/* Sunlit wooden floor / porch */}
        <rect x={-pw / 2 + border} y={6} width={pw - border * 2} height={ph / 2 - bottomBorder - 2}
          fill="#c8a872" />
        {/* Floor highlight */}
        <rect x={-pw / 2 + border} y={6} width={pw - border * 2} height={4}
          fill="rgba(255,255,255,0.15)" />
        {/* Black cat body — sitting, facing slightly right */}
        <ellipse cx={0} cy={8} rx={12} ry={10} fill="#1a1a1a" />
        {/* Cat head */}
        <circle cx={2} cy={-4} r={8} fill="#1a1a1a" />
        {/* Ears — triangular */}
        <polygon points="-3,-11 -6,-4 0,-5" fill="#1a1a1a" />
        <polygon points="7,-11 4,-4 10,-5" fill="#1a1a1a" />
        {/* Inner ears — pink */}
        <polygon points="-2.5,-9 -5,-5 0,-5.5" fill="#5a3a3a" />
        <polygon points="6.5,-9 4.5,-5 9,-5.5" fill="#5a3a3a" />
        {/* Eyes — glowing green */}
        <ellipse cx={-2} cy={-4.5} rx={2} ry={1.8} fill="#2a5a2a" />
        <ellipse cx={5} cy={-4.5} rx={2} ry={1.8} fill="#2a5a2a" />
        {/* Pupils */}
        <ellipse cx={-1.5} cy={-4.5} rx={0.8} ry={1.6} fill="#000" />
        <ellipse cx={5.5} cy={-4.5} rx={0.8} ry={1.6} fill="#000" />
        {/* Eye shine */}
        <circle cx={-2.5} cy={-5.2} r={0.6} fill="rgba(255,255,255,0.7)" />
        <circle cx={4.5} cy={-5.2} r={0.6} fill="rgba(255,255,255,0.7)" />
        {/* Nose — tiny pink triangle */}
        <polygon points="1.5,-1.5 1,-0.5 2,-0.5" fill="#8a5a5a" />
        {/* Whiskers */}
        <line x1={-3} y1={-1} x2={-12} y2={-3} stroke="#444" strokeWidth="0.5" />
        <line x1={-3} y1={0} x2={-12} y2={1} stroke="#444" strokeWidth="0.5" />
        <line x1={6} y1={-1} x2={14} y2={-3} stroke="#444" strokeWidth="0.5" />
        <line x1={6} y1={0} x2={14} y2={1} stroke="#444" strokeWidth="0.5" />
        {/* Tail — curving to the right */}
        <path d="M10,12 Q18,8 20,0 Q21,-4 18,-6" fill="none" stroke="#1a1a1a" strokeWidth="3.5" strokeLinecap="round" />
        {/* Front paws */}
        <ellipse cx={-5} cy={16} rx={3} ry={2} fill="#1a1a1a" />
        <ellipse cx={5} cy={16} rx={3} ry={2} fill="#1a1a1a" />
        {/* Cat fur shine */}
        <path d="M-6,2 Q-2,-2 2,2" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
        {/* Photo gloss/reflection */}
        <rect x={-pw / 2 + border} y={-ph / 2 + border} width={pw - border * 2} height={15}
          fill="rgba(255,255,255,0.1)" />
      </g>
    );
  };

  const renderPiecePiles = () =>
    game.players.map((player, idx) => {
      const corner = PILE_CORNERS[idx];
      const elements: React.ReactNode[] = [];

      // Player label
      elements.push(
        <text key={`label-${idx}`} x={corner.x + 80} y={corner.y + 12}
          fill={player.color} fontSize="16" fontWeight="bold" textAnchor="middle"
          stroke="rgba(0,0,0,0.7)" strokeWidth="3.5" paintOrder="stroke">
          {player.name}
        </text>
      );

      // Settlements — row below label
      const settY = corner.y + 40;
      for (let i = 0; i < player.pieces.settlements; i++) {
        elements.push(renderTableSettlement(player.color, corner.x + 20 + i * 34, settY, idx * 100 + i));
      }

      // Cities — row below settlements
      const cityY = settY + 42;
      for (let i = 0; i < player.pieces.cities; i++) {
        elements.push(renderTableCity(player.color, corner.x + 20 + i * 38, cityY, idx * 100 + 10 + i));
      }

      // Roads — rows below cities (4 per row)
      const roadY = cityY + 40;
      for (let i = 0; i < player.pieces.roads; i++) {
        const row = Math.floor(i / 4);
        const col = i % 4;
        elements.push(renderTableRoad(player.color, corner.x + 20 + col * 36, roadY + row * 18, idx * 100 + 20 + i));
      }

      // Hildeguard's personal items — wooden mug and cigar
      if (idx === 1) {
        elements.push(renderWoodenCup(corner.x - 140, corner.y + 15));
        elements.push(renderCigar(corner.x - 200, corner.y + 120));
      }

      // Tammy's polaroid of her black cat
      if (idx === 3) {
        elements.push(renderPolaroid(corner.x + 200, corner.y + 40));
      }

      return <g key={`pile-${idx}`}>{elements}</g>;
    });

  // ── JSX ──────────────────────────────────────────────────────────────────────

  return (
    <div className="game">
      <header className="header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
          {/* Left: menu button */}
          <button
            onClick={onLeaveGame}
            style={{ padding: '5px 12px', background: '#3a2a1a', border: '1px solid #6a4a2a', borderRadius: '6px', color: '#ccc', cursor: 'pointer', fontSize: '0.82rem', whiteSpace: 'nowrap', flexShrink: 0 }}
          >
            ← Menu
          </button>

          {/* Center: turn info */}
          <div className="turn-info" style={{ margin: 0, flex: 1, textAlign: 'center' }}>
            {isSetup
              ? isMyTurn
                ? game.setupStep === 'settlement'
                  ? 'Place your settlement on a green spot'
                  : 'Place a road next to your settlement'
                : `${currentPlayer?.name} is placing…`
              : `Turn ${game.turn} | ${currentPlayer?.name}'s Turn`}
          </div>

          {/* Right: room badge (multiplayer) or spacer */}
          {multiplayerConfig ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
              <span style={{ color: '#ffd700', fontWeight: 'bold', letterSpacing: '2px', fontSize: '0.8rem' }}>{multiplayerConfig.roomId}</span>
              <button onClick={handleCopyInviteLink} title="Copy invite link" style={{ background: 'none', border: '1px solid #4a6a8a', borderRadius: '4px', color: '#aaa', cursor: 'pointer', fontSize: '0.7rem', padding: '2px 5px' }}>
                📋
              </button>
            </div>
          ) : (
            <div style={{ width: '70px', flexShrink: 0 }} />
          )}
        </div>
      </header>

      {/* Player Stats */}
      <div className="player-bar">
        {game.players.map(player => (
          <div key={player.id}
            ref={el => { playerCardRefs.current[player.id] = el; }}
            className={`player-card ${player.id === game.currentPlayer ? 'active' : ''}`}
            style={{ '--player-color': player.color } as React.CSSProperties}>
            <div className="player-name" style={{ color: player.color, display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap', overflow: 'hidden' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{player.name}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px', flexShrink: 0 }} title={`Victory Points: ${getDisplayVP(player)}`}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2L9 8.5H3L7.5 12.5L5.5 19L12 15L18.5 19L16.5 12.5L21 8.5H15L12 2Z" fill="#ffd700" stroke="#b8960c" strokeWidth="1"/>
                  <path d="M7 20H17V22H7V20Z" fill="#ffd700" stroke="#b8960c" strokeWidth="0.5"/>
                  <path d="M5 22H19V23H5V22Z" fill="#daa520"/>
                </svg>
                <span style={{ color: '#ffd700', fontWeight: 800, fontSize: '0.8rem', textShadow: '0 0 6px rgba(255,215,0,0.3)' }}>{getDisplayVP(player)}</span>
              </span>
              {game.longestRoadHolder === player.id && (
                <span style={{ fontSize: '0.7em', flexShrink: 0 }} title="Longest Road">🛣️</span>
              )}
              {game.largestArmyHolder === player.id && (
                <span style={{ fontSize: '0.7em', flexShrink: 0 }} title="Largest Army">⚔️</span>
              )}
            </div>
            <div className="player-stats">
              <span title="Knights played">⚔️ {player.knightsPlayed}</span>
              <span title="Longest road segment">🛤️ {player.longestRoad}</span>
            </div>
            <div className="player-resources">
              <span className="resource" style={{ color: '#ccc' }}>
                {player.devCards.length} 🃏
              </span>
              <span className="resource" style={{ color: getTotalResources(player) >= 7 ? '#e74c3c' : '#aaa' }}>
                {getTotalResources(player)} 🂠
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Main Game Area */}
      <div className="game-area">
        <div className="board-container">
          {/* Recenter button */}
          {(viewBox.x !== DEFAULT_VB.x || viewBox.y !== DEFAULT_VB.y || viewBox.w !== DEFAULT_VB.w) && (
            <button
              onClick={() => setViewBox(DEFAULT_VB)}
              title="Recenter board"
              style={{
                position: 'absolute', top: 8, left: 8, zIndex: 12,
                background: 'rgba(18,12,6,0.85)', border: '1px solid #6a4a2a',
                borderRadius: '8px', padding: '4px 10px', color: '#daa520',
                cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600,
                backdropFilter: 'blur(4px)',
              }}>
              ⌖ Recenter
            </button>
          )}
          <svg
            ref={svgRef}
            viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
            className="board"
            width="800" height="660"
            style={{
              fontFamily: "'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif",
              cursor: isPanning ? 'grabbing' : 'grab',
            }}
            onMouseDown={e => {
              if (e.button !== 0) return;
              const target = e.target as Element;
              if (target.classList.contains('buildable-spot')) return;
              handlePanStart(e.clientX, e.clientY);
            }}
            onMouseMove={e => handlePanMove(e.clientX, e.clientY)}
            onMouseUp={() => {
              if (!panMoved.current && buildingMode && roadBuildingRoadsLeft === 0) {
                setBuildingMode(null);
              }
              handlePanEnd();
            }}
            onMouseLeave={handlePanEnd}
            onTouchStart={e => {
              if (e.touches.length === 2) {
                // Start pinch zoom
                const dx = e.touches[1].clientX - e.touches[0].clientX;
                const dy = e.touches[1].clientY - e.touches[0].clientY;
                pinchStartDist.current = Math.sqrt(dx * dx + dy * dy);
                pinchStartVB.current = { ...viewBox };
                const rect = svgRef.current?.getBoundingClientRect();
                if (rect) {
                  pinchMidRef.current = {
                    x: ((e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left) / rect.width,
                    y: ((e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top) / rect.height,
                  };
                }
                setIsPanning(false); // cancel any pan
                e.preventDefault();
              } else if (e.touches.length === 1) {
                // Don't start panning if touching a buildable spot
                const target = e.target as Element;
                if (target.classList.contains('buildable-spot')) return;
                handlePanStart(e.touches[0].clientX, e.touches[0].clientY);
              }
            }}
            onTouchMove={e => {
              if (e.touches.length === 2 && pinchStartDist.current > 0) {
                // Pinch zoom
                const dx = e.touches[1].clientX - e.touches[0].clientX;
                const dy = e.touches[1].clientY - e.touches[0].clientY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const scale = pinchStartDist.current / dist; // >1 = zoom out, <1 = zoom in
                const svb = pinchStartVB.current;
                const newW = Math.max(MIN_VB_SIZE, Math.min(MAX_VB_SIZE, svb.w * scale));
                const newH = Math.max(MIN_VB_SIZE, Math.min(MAX_VB_SIZE, svb.h * scale));
                const mx = pinchMidRef.current.x, my = pinchMidRef.current.y;
                const newX = Math.max(TABLE_VB.x, Math.min(TABLE_VB.x + TABLE_VB.w - newW, svb.x + (svb.w - newW) * mx));
                const newY = Math.max(TABLE_VB.y, Math.min(TABLE_VB.y + TABLE_VB.h - newH, svb.y + (svb.h - newH) * my));
                setViewBox({ x: newX, y: newY, w: newW, h: newH });
                e.preventDefault();
              } else if (e.touches.length === 1 && isPanning) {
                handlePanMove(e.touches[0].clientX, e.touches[0].clientY);
                e.preventDefault();
              }
            }}
            onTouchEnd={e => {
              if (e.touches.length < 2) pinchStartDist.current = 0;
              handlePanEnd();
            }}
            onWheel={handleZoom}
            onClick={() => {
              if (panMoved.current) return; // was a drag, not a click
              if (buildingMode && roadBuildingRoadsLeft === 0) {
                setBuildingMode(null);
              }
            }}>
            {renderBoardDefs()}
            {/* Table surface background — old pub table */}
            <rect x={TABLE_VB.x} y={TABLE_VB.y} width={TABLE_VB.w} height={TABLE_VB.h}
              fill="url(#table-surface)" rx="20" />
            {/* Table edge darkening */}
            <rect x={TABLE_VB.x} y={TABLE_VB.y} width={TABLE_VB.w} height={TABLE_VB.h}
              rx="20" fill="none" stroke="rgba(0,0,0,0.4)" strokeWidth="8" />
            {/* Scratches and wear marks */}
            <line x1="-400" y1="-380" x2="-320" y2="-370" stroke="rgba(255,255,255,0.04)" strokeWidth="1.5" />
            <line x1="350" y1="400" x2="420" y2="395" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
            <line x1="-450" y1="420" x2="-380" y2="430" stroke="rgba(0,0,0,0.08)" strokeWidth="1.5" />
            <line x1="400" y1="-450" x2="480" y2="-445" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
            <line x1="-200" y1="480" x2="-120" y2="475" stroke="rgba(0,0,0,0.06)" strokeWidth="1" />
            {/* Ring stains — old mug marks */}
            <circle cx="-380" cy="-420" r="18" fill="none" stroke="rgba(60,40,20,0.12)" strokeWidth="3" />
            <circle cx="-380" cy="-420" r="16" fill="none" stroke="rgba(60,40,20,0.06)" strokeWidth="1" />
            <circle cx="420" cy="450" r="15" fill="none" stroke="rgba(50,30,15,0.1)" strokeWidth="2.5" />
            <circle cx="-420" cy="480" r="20" fill="none" stroke="rgba(60,40,20,0.08)" strokeWidth="3" />
            {/* Dark water/ale stain blotch */}
            <ellipse cx="200" cy="-480" rx="25" ry="12" fill="rgba(40,25,10,0.1)" transform="rotate(-15,200,-480)" />
            <ellipse cx="-350" cy="500" rx="18" ry="10" fill="rgba(40,25,10,0.08)" transform="rotate(8,-350,500)" />
            {/* Piece piles around the table */}
            {renderPiecePiles()}
            {game.board.hexes.map(renderHex)}
            {renderPorts()}
            {renderRoads()}
            {renderSettlements()}
            {renderBuildableSpots()}
            {renderRobberTargets()}
          </svg>

          {/* Floating dev card icon — top-right of board */}
          {game.phase === 'playing' && (() => {
            const myPlayer = multiplayerConfig
              ? game.players[multiplayerConfig.mySlot]
              : game.players.find(p => p.isHuman);
            const myCards = myPlayer?.devCards ?? [];
            if (myCards.length === 0) return null;
            const hasPlayable = isMyTurn && !devCardPlayedThisTurn && !mustMoveRobber && !mustDiscard
              && myCards.some(c => c !== 'victory' && (devHandAtTurnStart[c] ?? 0) > 0);
            const cardCount = myCards.length;
            return (
              <button
                className={`floating-devcard-btn${hasPlayable ? ' devcard-glow' : ''}`}
                onClick={() => setDevCardModalOpen(true)}
                title="Dev Cards"
              >
                <div className="devcard-stack">
                  {cardCount >= 3 && <div className="devcard-back2" />}
                  {cardCount >= 2 && <div className="devcard-back" />}
                  <div className="devcard-front">🃏</div>
                </div>
                <span className="devcard-count">×{cardCount}</span>
              </button>
            );
          })()}

          {/* Dev card modal */}
          {devCardModalOpen && (() => {
            const myPlayer = multiplayerConfig
              ? game.players[multiplayerConfig.mySlot]
              : game.players.find(p => p.isHuman);
            const myCards = myPlayer?.devCards ?? [];
            const cardLabel: Record<string, string> = {
              knight: '⚔️ Knight', road: '🛣️ Road Building',
              plenty: '🌟 Year of Plenty', monopoly: '💰 Monopoly', victory: '🏆 Victory Point',
            };
            const cardDesc: Record<string, string> = {
              knight: 'Move the robber and steal a resource',
              road: 'Place 2 free roads anywhere',
              plenty: 'Take any 2 resources from the bank',
              monopoly: 'Steal all of one resource type from everyone',
              victory: 'Counts as 1 victory point',
            };
            return (
              <div
                style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}
                onClick={() => { setDevCardModalOpen(false); setDevCardMode(null); setYearOfPlentyPicks([]); }}
              >
                <div
                  style={{ background: '#1a2332', border: '2px solid #ffd700', borderRadius: '16px', padding: '20px', maxWidth: '380px', width: '100%', boxShadow: '0 8px 40px rgba(0,0,0,0.7)' }}
                  onClick={e => e.stopPropagation()}
                >
                  {/* Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <h3 style={{ margin: 0, color: '#ffd700', fontSize: '1.1rem' }}>🃏 Development Cards</h3>
                    <button
                      onClick={() => { setDevCardModalOpen(false); setDevCardMode(null); setYearOfPlentyPicks([]); }}
                      style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: '1.3rem', lineHeight: 1, padding: '2px 6px' }}
                    >✕</button>
                  </div>

                  {/* Year of Plenty picker */}
                  {devCardMode === 'plenty' && (
                    <div>
                      <div style={{ fontSize: '0.9rem', color: '#ffd700', marginBottom: '10px' }}>
                        🌟 Pick {2 - yearOfPlentyPicks.length} resource{2 - yearOfPlentyPicks.length !== 1 ? 's' : ''}:
                        {yearOfPlentyPicks.length > 0 && <span style={{ marginLeft: '6px' }}>{yearOfPlentyPicks.map(r => HEX_ICON[r]).join(' ')}</span>}
                      </div>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
                        {RESOURCES.map(r => (
                          <button key={r} onClick={() => handlePickYearOfPlentyResource(r)}
                            style={{ padding: '10px 14px', background: '#27ae60', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '1.3rem' }}>
                            {HEX_ICON[r]}
                          </button>
                        ))}
                      </div>
                      <button onClick={() => { setDevCardMode(null); setYearOfPlentyPicks([]); }}
                        style={{ padding: '6px 14px', background: '#444', border: 'none', borderRadius: '6px', color: '#fff', cursor: 'pointer', fontSize: '0.85rem' }}>
                        ← Back
                      </button>
                    </div>
                  )}

                  {/* Monopoly picker */}
                  {devCardMode === 'monopoly' && (
                    <div>
                      <div style={{ fontSize: '0.9rem', color: '#ffd700', marginBottom: '10px' }}>💰 Steal all of which resource?</div>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
                        {RESOURCES.map(r => (
                          <button key={r} onClick={() => handlePlayMonopoly(r)}
                            style={{ padding: '10px 14px', background: '#c0392b', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '1.3rem' }}
                            title={r}>
                            {HEX_ICON[r]}
                          </button>
                        ))}
                      </div>
                      <button onClick={() => setDevCardMode(null)}
                        style={{ padding: '6px 14px', background: '#444', border: 'none', borderRadius: '6px', color: '#fff', cursor: 'pointer', fontSize: '0.85rem' }}>
                        ← Back
                      </button>
                    </div>
                  )}

                  {/* Card list */}
                  {!devCardMode && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {(['knight', 'road', 'plenty', 'monopoly', 'victory'] as const).map(cardType => {
                        const count = myCards.filter(c => c === cardType).length;
                        if (count === 0) return null;
                        const canPlay = cardType !== 'victory' && isMyTurn && !devCardPlayedThisTurn && !mustMoveRobber && !mustDiscard && game.phase === 'playing' && (devHandAtTurnStart[cardType] ?? 0) > 0;
                        const newThisTurn = cardType !== 'victory' && !devCardPlayedThisTurn && (devHandAtTurnStart[cardType] ?? 0) === 0 && count > 0;
                        return (
                          <div key={cardType} style={{ background: '#253545', borderRadius: '10px', padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 'bold', fontSize: '0.95rem', marginBottom: '2px' }}>
                                {cardLabel[cardType]}
                                {count > 1 && <span style={{ color: '#aaa', marginLeft: '5px', fontWeight: 'normal' }}>×{count}</span>}
                                {cardType === 'victory' && <span style={{ color: '#ffd700', marginLeft: '5px' }}>+{count} VP</span>}
                              </div>
                              <div style={{ fontSize: '0.75rem', color: '#7a9ab0' }}>{cardDesc[cardType]}</div>
                            </div>
                            {canPlay && (
                              <button
                                onClick={() => {
                                  if (cardType === 'knight') { handlePlayKnight(); setDevCardModalOpen(false); }
                                  else if (cardType === 'road') { handlePlayRoadBuilding(); setDevCardModalOpen(false); }
                                  else if (cardType === 'plenty') setDevCardMode('plenty');
                                  else if (cardType === 'monopoly') setDevCardMode('monopoly');
                                }}
                                style={{ padding: '7px 16px', background: '#e67e22', border: 'none', borderRadius: '7px', color: '#fff', cursor: 'pointer', fontSize: '0.88rem', fontWeight: 'bold', whiteSpace: 'nowrap', flexShrink: 0 }}
                              >
                                Play
                              </button>
                            )}
                            {!canPlay && cardType !== 'victory' && (
                              <span style={{ fontSize: '0.75rem', color: '#666', whiteSpace: 'nowrap', flexShrink: 0 }}>
                                {devCardPlayedThisTurn ? 'used this turn' : newThisTurn ? 'next turn' : !isMyTurn ? 'not your turn' : ''}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Trade buttons moved to action panel */}

          {/* Bank Trade Modal */}
          {bankTradeModalOpen && (() => {
            const modalClose = () => { setBankTradeModalOpen(false); setTradeOffer({}); setTradeRequest({}); };
            // Compute credits locally to avoid any stale closure issues
            const localRatios = getTradeRatios(game, game.currentPlayer);
            const localCredits = RESOURCES.reduce((s, r) => s + Math.floor((tradeOffer[r] || 0) / (localRatios[r] || 4)), 0);
            const localRequestAmt = RESOURCES.reduce((s, r) => s + (tradeRequest[r] || 0), 0);
            const canExecute = localCredits > 0 && localRequestAmt > 0 && localRequestAmt <= localCredits;
            const anythingSelected = RESOURCES.some(r => (tradeOffer[r] || 0) > 0) || RESOURCES.some(r => (tradeRequest[r] || 0) > 0);
            const bankCanSelect = localCredits > localRequestAmt;
            return (
              <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }} onClick={modalClose}>
                <div style={{ background: '#1a2332', border: '2px solid #ffd700', borderRadius: '16px', padding: '20px', maxWidth: '400px', width: '100%', boxShadow: '0 8px 40px rgba(0,0,0,0.7)' }} onClick={e => e.stopPropagation()}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                    <h3 style={{ margin: 0, color: '#ffd700', fontSize: '1.1rem' }}>🏦 Bank Trade</h3>
                    <button onClick={modalClose} style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: '1.3rem', padding: '2px 6px' }}>✕</button>
                  </div>

                  {/* YOU GIVE row */}
                  <div style={{ fontSize: '0.72rem', color: '#8899aa', marginBottom: '6px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>🙋 You Give <span style={{ color: '#445', fontWeight: 400 }}>(tap to add {(localRatios[RESOURCES[0]] || 4)}x of same resource)</span></div>
                  <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
                    {RESOURCES.map(r => {
                      const offered = tradeOffer[r] || 0;
                      const have = currentPlayer?.resources[r] || 0;
                      const ratio = localRatios[r] || 4;
                      const creditsFromThis = Math.floor(offered / ratio);
                      return (
                        <div key={r} onClick={() => { if (offered < have) setTradeOffer(p => ({ ...p, [r]: (p[r] || 0) + 1 })); }} style={{
                          flex: 1, cursor: offered < have ? 'pointer' : 'default', borderRadius: '12px', padding: '10px 4px',
                          background: offered > 0 ? '#2a1800' : '#141e2a',
                          border: `2px solid ${offered > 0 ? (creditsFromThis > 0 ? '#27ae60' : '#e67e22') : '#2a3a4a'}`,
                          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
                          userSelect: 'none', transition: 'background 0.12s, border-color 0.12s',
                          opacity: have === 0 ? 0.4 : 1,
                        }}>
                          <span style={{ fontSize: '2.4rem', lineHeight: 1 }}>{HEX_ICON[r]}</span>
                          <span style={{ fontSize: '0.6rem', color: '#566a66', fontWeight: 600 }}>{ratio}:1</span>
                          <span style={{ fontSize: '1.15rem', fontWeight: 'bold', color: offered > 0 ? (creditsFromThis > 0 ? '#27ae60' : '#e67e22') : '#333', minHeight: '1.4em', lineHeight: 1 }}>
                            {offered > 0 ? offered : ''}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Divider with credit status + clear */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                    <div style={{ flex: 1, height: '1px', background: '#2a3a4a' }} />
                    <span style={{ fontSize: '0.8rem', color: localCredits > 0 ? '#27ae60' : '#445', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {localCredits > 0
                        ? `✓ ${localCredits} credit${localCredits > 1 ? 's' : ''}${localRequestAmt > 0 ? ` · ${localRequestAmt} used` : ''}`
                        : '⬇ tap to earn credits'}
                    </span>
                    <div style={{ flex: 1, height: '1px', background: '#2a3a4a' }} />
                    {anythingSelected && (
                      <button onClick={() => { setTradeOffer({}); setTradeRequest({}); }}
                        style={{ padding: '3px 10px', background: '#2a3a4a', border: 'none', borderRadius: '6px', color: '#aaa', cursor: 'pointer', fontSize: '0.75rem' }}>
                        ✕ Clear
                      </button>
                    )}
                  </div>

                  {/* BANK GIVES row */}
                  <div style={{ fontSize: '0.72rem', color: bankCanSelect ? '#27ae60' : '#8899aa', marginBottom: '6px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{bankCanSelect ? '✓' : '🏦'} Bank Gives <span style={{ color: bankCanSelect ? '#27ae60' : '#445', fontWeight: 400 }}>{bankCanSelect ? '(tap to select)' : localCredits === 0 ? '(earn credits first)' : '(all credits used)'}</span></div>
                  <div style={{ display: 'flex', gap: '6px', marginBottom: '14px' }}>
                    {RESOURCES.map(r => {
                      const requested = tradeRequest[r] || 0;
                      const canAdd = localRequestAmt < localCredits;
                      return (
                        <div key={r} onClick={() => { if (canAdd) setTradeRequest(p => ({ ...p, [r]: (p[r] || 0) + 1 })); }} style={{
                          flex: 1, cursor: canAdd ? 'pointer' : 'default', borderRadius: '12px', padding: '10px 4px',
                          background: requested > 0 ? '#001e10' : (canAdd ? '#141e2a' : '#0d1218'),
                          border: `2px solid ${requested > 0 ? '#27ae60' : (canAdd ? '#3a5a4a' : '#2a3a4a')}`,
                          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
                          userSelect: 'none', transition: 'background 0.12s, border-color 0.12s',
                          opacity: canAdd || requested > 0 ? 1 : 0.5,
                        }}>
                          <span style={{ fontSize: '2.4rem', lineHeight: 1 }}>{HEX_ICON[r]}</span>
                          <span style={{ fontSize: '1.15rem', fontWeight: 'bold', color: requested > 0 ? '#27ae60' : '#333', minHeight: '1.4em', lineHeight: 1 }}>
                            {requested > 0 ? `+${requested}` : ''}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <button onClick={handleBankTrade} disabled={!canExecute}
                    style={{ width: '100%', padding: '11px', background: canExecute ? '#e67e22' : '#2a3040', border: 'none', borderRadius: '8px', color: canExecute ? '#fff' : '#555', fontWeight: 'bold', cursor: canExecute ? 'pointer' : 'default', fontSize: '0.95rem' }}>
                    Execute Trade
                  </button>
                </div>
              </div>
            );
          })()}

          {/* Player Trade Modal */}
          {playerTradeModalOpen && (() => {
            const modalClose = () => {
              setPlayerTradeModalOpen(false);
              setPlayerTradeOffer({});
              setPlayerTradeRequest({});
              setPlayerTradeResponses([]);
              // If we had a pending human trade proposal, cancel it
              if (myPendingHumanTradeIdRef.current) {
                myPendingHumanTradeIdRef.current = null;
                setGame(prev => ({ ...prev, pendingHumanTrade: null }));
              }
              // Don't auto-decline AI trade — keep glow so user can reopen
            };
            const isIncoming = !!aiTradeProposal;
            const tapCell = (r: Resource, count: number, onTap: () => void, accent: string) => (
              <div key={r} onClick={onTap} style={{ flex: 1, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', background: count > 0 ? (accent === '#e67e22' ? '#2a1a08' : '#0a2218') : '#182030', border: `2px solid ${count > 0 ? accent : '#2a3a4a'}`, borderRadius: '12px', padding: '10px 4px', userSelect: 'none' }}>
                <span style={{ fontSize: '2.4rem', lineHeight: 1 }}>{HEX_ICON[r]}</span>
                <span style={{ fontSize: '1.15rem', fontWeight: 'bold', color: count > 0 ? accent : '#333', minHeight: '1.4em', lineHeight: 1 }}>{count > 0 ? `+${count}` : ''}</span>
              </div>
            );
            const hasOffer = RESOURCES.some(r => (playerTradeOffer[r] || 0) > 0);
            const hasRequest = RESOURCES.some(r => (playerTradeRequest[r] || 0) > 0);
            const showingResponses = playerTradeResponses.length > 0;
            return (
              <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }} onClick={modalClose}>
                <div style={{ background: '#1a2332', border: '2px solid #ffd700', borderRadius: '16px', padding: '20px', maxWidth: '420px', width: '100%', boxShadow: '0 8px 40px rgba(0,0,0,0.7)' }} onClick={e => e.stopPropagation()}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                    <h3 style={{ margin: 0, color: '#ffd700', fontSize: '1.1rem' }}>🤝 Player Trade</h3>
                    <button onClick={modalClose} style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: '1.3rem', padding: '2px 6px' }}>✕</button>
                  </div>

                  {isIncoming ? (
                    /* ── Incoming trade offer from AI ── */
                    (() => {
                      const aiPlayer = game.players[aiTradeProposal!.fromPlayer];
                      const humanPlayer = game.players.find(p => p.isHuman && (multiplayerConfig ? p.id === multiplayerConfig.mySlot : true));
                      const btnBase: React.CSSProperties = { border: 'none', borderRadius: '8px', color: '#fff', cursor: 'pointer', fontWeight: 'bold', padding: '10px', fontSize: '0.9rem' };

                      // Counter result view
                      if (counterResult) return (
                        <div>
                          <div style={{ fontWeight: 'bold', marginBottom: '14px', fontSize: '1rem', color: counterResult === 'accepted' ? '#27ae60' : '#e74c3c', textAlign: 'center' }}>
                            {counterResult === 'accepted' ? '✅ Counter accepted!' : '❌ Counter declined'}
                          </div>
                          {counterResult === 'accepted' ? (
                            <button onClick={handleExecuteCounter} style={{ ...btnBase, background: '#27ae60', width: '100%' }}>
                              ✓ Execute Trade
                            </button>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                              <button onClick={() => { setCounterMode(true); setCounterResult(null); }} style={{ ...btnBase, background: '#2a5a8a', width: '100%' }}>
                                ↩ Try Different Counter
                              </button>
                              <button onClick={handleBackToOriginal} style={{ ...btnBase, background: '#4a4a20', width: '100%' }}>
                                See Original Offer
                              </button>
                              <button onClick={() => { handleDeclineAiTrade(); setPlayerTradeModalOpen(false); }} style={{ ...btnBase, background: '#7b1a1a', width: '100%' }}>
                                ✗ Decline
                              </button>
                            </div>
                          )}
                        </div>
                      );

                      // Counter editing mode
                      if (counterMode) {
                        const totalCounterGive = RESOURCES.reduce((s, r) => s + (counterOffering[r] || 0), 0);
                        const totalCounterReceive = RESOURCES.reduce((s, r) => s + (counterRequesting[r] || 0), 0);
                        const humanCanAffordCounter = humanPlayer && RESOURCES.every(r => (humanPlayer.resources[r] || 0) >= (counterRequesting[r] || 0));
                        const tapCellCounter = (r: Resource, count: number, onTap: () => void, accent: string) => (
                          <div key={r} onClick={onTap} style={{ flex: 1, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', background: count > 0 ? (accent === '#e67e22' ? '#2a1a08' : '#0a2218') : '#182030', border: `2px solid ${count > 0 ? accent : '#2a3a4a'}`, borderRadius: '12px', padding: '10px 4px', userSelect: 'none' }}>
                            <span style={{ fontSize: '2.4rem', lineHeight: 1 }}>{HEX_ICON[r]}</span>
                            <span style={{ fontSize: '1.15rem', fontWeight: 'bold', color: count > 0 ? accent : '#333', minHeight: '1.4em', lineHeight: 1 }}>{count > 0 ? `+${count}` : ''}</span>
                          </div>
                        );
                        return (
                          <div>
                            <div style={{ fontWeight: 'bold', marginBottom: '12px', color: '#7ab8e8', fontSize: '0.95rem' }}>
                              📝 Counter-Offer to {aiPlayer.name}
                            </div>

                            <div style={{ fontSize: '0.7rem', color: '#8899aa', marginBottom: '6px', fontWeight: 600, textTransform: 'uppercase' }}>They Give You</div>
                            <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
                              {RESOURCES.map(r => {
                                const val = counterOffering[r] || 0;
                                const aiHas = aiPlayer.resources[r] || 0;
                                return tapCellCounter(r, val, () => { if (val < aiHas) setCounterOffering(p => ({ ...p, [r]: val + 1 })); }, '#27ae60');
                              })}
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                              <div style={{ flex: 1, height: '1px', background: '#2a3a4a' }} />
                              {(totalCounterGive > 0 || totalCounterReceive > 0) && (
                                <button onClick={() => { setCounterOffering({}); setCounterRequesting({}); }}
                                  style={{ padding: '4px 12px', background: 'none', border: '1px solid #555', borderRadius: '6px', color: '#aaa', cursor: 'pointer', fontSize: '0.75rem' }}>
                                  ✕ Clear
                                </button>
                              )}
                              <div style={{ flex: 1, height: '1px', background: '#2a3a4a' }} />
                            </div>

                            <div style={{ fontSize: '0.7rem', color: '#8899aa', marginBottom: '6px', fontWeight: 600, textTransform: 'uppercase' }}>You Give</div>
                            <div style={{ display: 'flex', gap: '6px', marginBottom: '14px' }}>
                              {RESOURCES.map(r => {
                                const val = counterRequesting[r] || 0;
                                const youHave = humanPlayer?.resources[r] || 0;
                                return tapCellCounter(r, val, () => { if (val < youHave) setCounterRequesting(p => ({ ...p, [r]: val + 1 })); }, '#e67e22');
                              })}
                            </div>

                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button onClick={handleSendCounter}
                                disabled={totalCounterGive === 0 || totalCounterReceive === 0 || !humanCanAffordCounter}
                                style={{ ...btnBase, flex: 2, background: (totalCounterGive > 0 && totalCounterReceive > 0 && humanCanAffordCounter) ? '#2a5a8a' : '#333' }}>
                                📤 Send Counter
                              </button>
                              <button onClick={handleBackToOriginal} style={{ ...btnBase, flex: 1, background: '#444' }}>
                                ← Back
                              </button>
                            </div>
                          </div>
                        );
                      }

                      // Original offer view
                      const canAffordOriginal = humanPlayer && RESOURCES.every(r => (humanPlayer.resources[r] || 0) >= (aiTradeProposal!.requesting[r] || 0));
                      return (
                        <div>
                          <div style={{ fontWeight: 'bold', marginBottom: '14px', color: '#27ae60', fontSize: '1rem' }}>
                            {aiPlayer.name} wants to trade!
                          </div>

                          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                            <div style={{ flex: 1, background: '#0a2218', border: '1px solid #27ae6055', borderRadius: '12px', padding: '12px 10px', textAlign: 'center' }}>
                              <div style={{ fontSize: '0.65rem', color: '#8899aa', marginBottom: '8px', fontWeight: 600, textTransform: 'uppercase' }}>They Give You</div>
                              <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '6px' }}>
                                {RESOURCES.filter(r => (aiTradeProposal!.offering[r] || 0) > 0).map(r => (
                                  <div key={r} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                                    <span style={{ fontSize: '2rem' }}>{HEX_ICON[r]}</span>
                                    <span style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#27ae60' }}>+{aiTradeProposal!.offering[r]}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div style={{ flex: 1, background: '#2a1a08', border: '1px solid #e67e2255', borderRadius: '12px', padding: '12px 10px', textAlign: 'center' }}>
                              <div style={{ fontSize: '0.65rem', color: '#8899aa', marginBottom: '8px', fontWeight: 600, textTransform: 'uppercase' }}>You Give</div>
                              <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '6px' }}>
                                {RESOURCES.filter(r => (aiTradeProposal!.requesting[r] || 0) > 0).map(r => (
                                  <div key={r} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                                    <span style={{ fontSize: '2rem' }}>{HEX_ICON[r]}</span>
                                    <span style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#e67e22' }}>+{aiTradeProposal!.requesting[r]}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>

                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button onClick={() => { handleAcceptAiTrade(); setPlayerTradeModalOpen(false); }} disabled={!canAffordOriginal}
                              style={{ ...btnBase, flex: 1, background: canAffordOriginal ? '#27ae60' : '#555', cursor: canAffordOriginal ? 'pointer' : 'not-allowed' }}>
                              ✓ Accept
                            </button>
                            <button onClick={handleStartCounter} style={{ ...btnBase, flex: 1, background: '#2a5a8a' }}>
                              ✏️ Counter
                            </button>
                            <button onClick={() => { handleDeclineAiTrade(); setPlayerTradeModalOpen(false); }} style={{ ...btnBase, flex: 1, background: '#7b1a1a' }}>
                              ✗ Decline
                            </button>
                          </div>
                        </div>
                      );
                    })()
                  ) : showingResponses ? (
                    /* Responses view */
                    <div>
                      <div style={{ fontSize: '0.82rem', color: '#aaa', marginBottom: '12px', textAlign: 'center' }}>
                        Offering: {RESOURCES.filter(r => playerTradeOffer[r]).map(r => `${playerTradeOffer[r]}${HEX_ICON[r]}`).join(' ')}
                        <span style={{ color: '#555', margin: '0 6px' }}>→</span>
                        Getting: {RESOURCES.filter(r => playerTradeRequest[r]).map(r => `${playerTradeRequest[r]}${HEX_ICON[r]}`).join(' ')}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
                        {playerTradeResponses.map(({ playerId, accepts, isPending }) => {
                          const p = game.players[playerId];
                          return (
                            <div key={playerId} style={{ display: 'flex', alignItems: 'center', gap: '10px', background: '#1e2e3e', borderRadius: '8px', padding: '10px 14px' }}>
                              <span style={{ color: p.color, fontWeight: 'bold', flex: 1 }}>{p.name}</span>
                              {isPending
                                ? <span style={{ color: '#f39c12', fontSize: '0.85rem' }}>⏳ Thinking…</span>
                                : accepts
                                  ? <button onClick={() => handleExecutePlayerTrade(playerId)} style={{ padding: '6px 16px', background: '#27ae60', border: 'none', borderRadius: '7px', color: '#fff', cursor: 'pointer', fontWeight: 'bold' }}>✓ Trade!</button>
                                  : <span style={{ color: '#666', fontSize: '0.85rem' }}>✗ Declines</span>}
                            </div>
                          );
                        })}
                      </div>
                      <button onClick={() => {
                        if (myPendingHumanTradeIdRef.current) {
                          myPendingHumanTradeIdRef.current = null;
                          setGame(prev => ({ ...prev, pendingHumanTrade: null }));
                        }
                        setPlayerTradeResponses([]);
                      }}
                        style={{ padding: '8px 16px', background: '#2a3a4a', border: 'none', borderRadius: '8px', color: '#aaa', cursor: 'pointer', fontSize: '0.85rem' }}>
                        ← Edit Offer
                      </button>
                    </div>
                  ) : (
                    /* Offer builder */
                    <div>
                      {/* YOU GIVE row */}
                      <div style={{ fontSize: '0.7rem', color: '#8899aa', marginBottom: '6px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>🙋 You Give</div>
                      <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
                        {RESOURCES.map(r => {
                          const offered = playerTradeOffer[r] || 0;
                          const have = currentPlayer?.resources[r] || 0;
                          return tapCell(r, offered, () => {
                            if (offered < have) setPlayerTradeOffer(p => ({ ...p, [r]: offered + 1 }));
                          }, '#e67e22');
                        })}
                      </div>

                      {/* Divider with Clear */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                        <div style={{ flex: 1, height: '1px', background: '#2a3a4a' }} />
                        {(hasOffer || hasRequest) && (
                          <button onClick={() => { setPlayerTradeOffer({}); setPlayerTradeRequest({}); }}
                            style={{ padding: '4px 12px', background: 'none', border: '1px solid #555', borderRadius: '6px', color: '#aaa', cursor: 'pointer', fontSize: '0.75rem' }}>
                            ✕ Clear
                          </button>
                        )}
                        <div style={{ flex: 1, height: '1px', background: '#2a3a4a' }} />
                      </div>

                      {/* THEY GIVE row */}
                      <div style={{ fontSize: '0.7rem', color: '#8899aa', marginBottom: '6px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>🤝 They Give</div>
                      <div style={{ display: 'flex', gap: '6px', marginBottom: '14px' }}>
                        {RESOURCES.map(r => {
                          const requested = playerTradeRequest[r] || 0;
                          return tapCell(r, requested, () => {
                            setPlayerTradeRequest(p => ({ ...p, [r]: requested + 1 }));
                          }, '#27ae60');
                        })}
                      </div>

                      <button onClick={handleProposePlayerTrade} disabled={!hasOffer || !hasRequest}
                        style={{ width: '100%', padding: '11px', background: hasOffer && hasRequest ? '#2a5a9a' : '#2a3a4a', border: 'none', borderRadius: '8px', color: hasOffer && hasRequest ? '#fff' : '#555', fontWeight: 'bold', cursor: hasOffer && hasRequest ? 'pointer' : 'default', fontSize: '0.95rem' }}>
                        Send Proposal
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Incoming Human Trade Modal — shown to non-offering players in multiplayer */}
          {incomingHumanTrade && multiplayerConfig && (() => {
            const fromPlayer = game.players[incomingHumanTrade.fromPlayer];
            const myPlayer = game.players[multiplayerConfig.mySlot];
            const canAffordTrade = RESOURCES.every(r => (myPlayer.resources[r] || 0) >= (incomingHumanTrade.requesting[r] || 0));
            return (
              <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
                <div style={{ background: '#1a2332', border: `2px solid ${fromPlayer.color}`, borderRadius: '16px', padding: '20px', maxWidth: '420px', width: '100%', boxShadow: '0 8px 40px rgba(0,0,0,0.7)' }}>
                  <h3 style={{ margin: '0 0 4px', color: '#ffd700', fontSize: '1.1rem' }}>🤝 Trade Offer</h3>
                  <div style={{ fontWeight: 'bold', marginBottom: '16px', color: fromPlayer.color, fontSize: '0.95rem' }}>
                    {fromPlayer.name} wants to trade!
                  </div>
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                    <div style={{ flex: 1, background: '#0a2218', border: '1px solid #27ae6055', borderRadius: '12px', padding: '12px 10px', textAlign: 'center' }}>
                      <div style={{ fontSize: '0.65rem', color: '#8899aa', marginBottom: '8px', fontWeight: 600, textTransform: 'uppercase' }}>They Give You</div>
                      <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '6px' }}>
                        {RESOURCES.filter(r => (incomingHumanTrade.offering[r] || 0) > 0).map(r => (
                          <div key={r} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                            <span style={{ fontSize: '2rem' }}>{HEX_ICON[r]}</span>
                            <span style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#27ae60' }}>+{incomingHumanTrade.offering[r]}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div style={{ flex: 1, background: '#2a1a08', border: '1px solid #e67e2255', borderRadius: '12px', padding: '12px 10px', textAlign: 'center' }}>
                      <div style={{ fontSize: '0.65rem', color: '#8899aa', marginBottom: '8px', fontWeight: 600, textTransform: 'uppercase' }}>You Give</div>
                      <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '6px' }}>
                        {RESOURCES.filter(r => (incomingHumanTrade.requesting[r] || 0) > 0).map(r => (
                          <div key={r} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                            <span style={{ fontSize: '2rem' }}>{HEX_ICON[r]}</span>
                            <span style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#e67e22' }}>+{incomingHumanTrade.requesting[r]}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  {!canAffordTrade && (
                    <div style={{ fontSize: '0.8rem', color: '#e74c3c', marginBottom: '10px', textAlign: 'center' }}>
                      You don't have the required resources.
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={handleAcceptIncomingHumanTrade}
                      disabled={!canAffordTrade}
                      style={{ flex: 1, border: 'none', borderRadius: '8px', color: '#fff', fontWeight: 'bold', padding: '11px', fontSize: '0.95rem', background: canAffordTrade ? '#27ae60' : '#555', cursor: canAffordTrade ? 'pointer' : 'not-allowed' }}>
                      ✓ Accept
                    </button>
                    <button
                      onClick={handleDeclineIncomingHumanTrade}
                      style={{ flex: 1, border: 'none', borderRadius: '8px', color: '#fff', fontWeight: 'bold', padding: '11px', fontSize: '0.95rem', background: '#7b1a1a', cursor: 'pointer' }}>
                      ✗ Decline
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Build button moved to action panel */}

          {/* Build / Buy modal */}
          {buildModalOpen && (() => {
            const modalClose = () => setBuildModalOpen(false);
            const items = [
              {
                id: 'road' as const,
                icon: '🛣️',
                name: 'Road',
                cost: '1🌲 + 1🧱',
                canAfford: canBuildRoad,
                disabled: !canBuildRoad || roadBuildingRoadsLeft > 0,
                active: buildingMode === 'road',
                action: () => { handleBuildToggle('road'); modalClose(); },
                label: buildingMode === 'road' ? '✓ Placing…' : 'Build',
              },
              {
                id: 'settlement' as const,
                icon: '🏠',
                name: 'Settlement',
                cost: '1🌲 + 1🧱 + 1🌾 + 1🐑',
                canAfford: canBuildSettlement,
                disabled: !canBuildSettlement,
                active: buildingMode === 'settlement',
                action: () => { handleBuildToggle('settlement'); modalClose(); },
                label: buildingMode === 'settlement' ? '✓ Placing…' : 'Build',
              },
              {
                id: 'city' as const,
                icon: '🏰',
                name: 'City',
                cost: '2🌾 + 3⛏️',
                canAfford: canBuildCity,
                disabled: !canBuildCity,
                active: buildingMode === 'city',
                action: () => { handleBuildToggle('city'); modalClose(); },
                label: buildingMode === 'city' ? '✓ Placing…' : 'Upgrade',
              },
              {
                id: 'devcard' as const,
                icon: '🃏',
                name: 'Dev Card',
                cost: '1🌾 + 1🐑 + 1⛏️',
                canAfford: canBuildDevCard,
                disabled: !canBuildDevCard,
                active: false,
                action: () => { handleBuyDevCard(); modalClose(); },
                label: 'Buy',
              },
            ];
            return (
              <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }} onClick={modalClose}>
                <div style={{ background: '#1a2332', border: '2px solid #e67e22', borderRadius: '16px', padding: '20px', maxWidth: '400px', width: '100%', boxShadow: '0 8px 40px rgba(0,0,0,0.7)' }} onClick={e => e.stopPropagation()}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <h3 style={{ margin: 0, color: '#e67e22', fontSize: '1.1rem' }}>⚒️ Build / Buy</h3>
                    <button onClick={modalClose} style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: '1.3rem', padding: '2px 6px' }}>✕</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    {items.map(item => (
                      <div key={item.id} style={{
                        background: item.active ? '#2a3a1a' : item.canAfford ? '#1e2c3a' : '#161e28',
                        border: `2px solid ${item.active ? '#27ae60' : item.canAfford ? '#e67e22' : '#2a3040'}`,
                        borderRadius: '12px', padding: '16px 12px',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px',
                        opacity: item.disabled && !item.active ? 0.55 : 1,
                      }}>
                        <span style={{ fontSize: '2.6rem', lineHeight: 1 }}>{item.icon}</span>
                        <span style={{ fontWeight: 'bold', fontSize: '1rem', color: '#f0f0f0' }}>{item.name}</span>
                        <span style={{ fontSize: '0.72rem', color: '#8899aa', textAlign: 'center', lineHeight: 1.4 }}>{item.cost}</span>
                        <button
                          onClick={item.disabled ? undefined : item.action}
                          disabled={item.disabled}
                          style={{
                            marginTop: '4px', padding: '7px 18px',
                            background: item.active ? '#27ae60' : item.canAfford ? '#e67e22' : '#2a3040',
                            border: 'none', borderRadius: '7px',
                            color: item.canAfford || item.active ? '#fff' : '#555',
                            fontWeight: 'bold', fontSize: '0.88rem',
                            cursor: item.disabled ? 'default' : 'pointer',
                            width: '100%',
                          }}
                        >
                          {item.label}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Dice moved to action panel */}
        </div>

        {/* Action Panel — hidden during setup */}
        {!isSetup && <div className="action-panel">
          {isHumanTurn && multiplayerConfig && !isMyTurn ? (
            // Multiplayer: another human player's turn — show waiting message
            <div style={{ padding: '20px', background: '#1a2a3a', borderRadius: '8px', textAlign: 'center' }}>
              <div style={{ fontSize: '2rem', marginBottom: '8px' }}>⏳</div>
              <div style={{ color: currentPlayer.color, fontWeight: 'bold', fontSize: '1.1rem', marginBottom: '4px' }}>
                {currentPlayer.name}'s turn
              </div>
              <div style={{ color: '#aaa', fontSize: '0.9rem' }}>Waiting for their move…</div>
            </div>
          ) : (
            <>
              {/* Action row: Dice | Build | Trade buttons */}
              {game.phase === 'playing' && (() => {
                const canBuildAnythingAction = isMyTurn && !mustMoveRobber && !mustDiscard && game.dice
                  && (canBuildRoad || canBuildSettlement || canBuildCity || canBuildDevCard);
                const isActiveAction = isMyTurn && !mustMoveRobber && !mustDiscard && !!game.dice;
                const needsRoll = isMyTurn && !game.dice && !isRolling;
                const canTrade = isMyTurn && !!game.dice && !mustMoveRobber && !mustDiscard;
                const hasIncomingTrade = !!aiTradeProposal;
                const playersBtnActive = canTrade || hasIncomingTrade;
                const playersGlow = hasIncomingTrade && !playerTradeModalOpen;
                const dieClass = (extra: string) =>
                  `die floating-die${isRolling ? ' die-rolling' : game.dice ? ' die-landed' : ''}${extra}`;
                const actionBtnStyle = (active: boolean, borderColor: string, glow = false, glowColor = ''): React.CSSProperties => ({
                  background: 'rgba(18, 12, 6, 0.88)',
                  border: `2px solid ${borderColor}`,
                  borderRadius: '10px', padding: '6px 10px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: active ? 'pointer' : 'default',
                  transition: 'border-color 0.3s, box-shadow 0.3s',
                  boxShadow: glow ? `0 0 12px ${glowColor}` : 'none',
                  animation: glow ? 'floating-build-glow 1.6s ease-in-out infinite' : 'none',
                });
                return (
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                    {/* Dice */}
                    <button
                      className={needsRoll ? 'dice-glow' : ''}
                      onClick={needsRoll ? handleRollDice : undefined}
                      disabled={!needsRoll && !isRolling && !game.dice}
                      title={needsRoll ? 'Roll Dice' : game.dice ? `${game.dice[0]} + ${game.dice[1]} = ${game.dice[0] + game.dice[1]}` : ''}
                      style={{
                        ...actionBtnStyle(needsRoll, needsRoll ? '#ffd700' : '#555', needsRoll, 'rgba(255,215,0,0.35)'),
                        gap: '4px',
                      }}
                    >
                      <span className={dieClass('')} style={{ width: '30px', height: '30px', fontSize: '1rem' }}>
                        <DiceDots value={isRolling ? animDice[0] : game.dice ? game.dice[0] : null} />
                      </span>
                      <span className={dieClass('')} style={{ width: '30px', height: '30px', fontSize: '1rem' }}>
                        <DiceDots value={isRolling ? animDice[1] : game.dice ? game.dice[1] : null} />
                      </span>
                    </button>

                    {/* Build */}
                    <button
                      onClick={() => isActiveAction && setBuildModalOpen(true)}
                      title="Build / Buy"
                      style={actionBtnStyle(isActiveAction, canBuildAnythingAction ? '#e67e22' : '#3a3020', !!canBuildAnythingAction, 'rgba(230,126,34,0.35)')}
                    >
                      <span style={{ fontSize: '1.5rem', lineHeight: 1 }}>⚒️</span>
                    </button>

                    {/* Trade: Players */}
                    <button
                      onClick={() => playersBtnActive && setPlayerTradeModalOpen(true)}
                      title={hasIncomingTrade ? 'Incoming trade offer!' : 'Trade with Players'}
                      style={{
                        ...actionBtnStyle(playersBtnActive, playersGlow ? '#ffd700' : playersBtnActive ? '#27ae60' : '#3a4a3a', playersGlow, 'rgba(255,215,0,0.35)'),
                      }}
                    >
                      <span style={{ fontSize: '1.5rem', lineHeight: 1 }}>🤝</span>
                    </button>

                    {/* Trade: Bank */}
                    <button
                      onClick={() => canTrade && setBankTradeModalOpen(true)}
                      title="Trade with Bank"
                      style={actionBtnStyle(canTrade, canTrade ? '#27ae60' : '#3a4a3a')}
                    >
                      <span style={{ fontSize: '1.5rem', lineHeight: 1 }}>🏦</span>
                    </button>
                  </div>
                );
              })()}

              {/* Discard UI — shown when rolling 7 with 8+ cards */}
              {humanDiscardPending && (() => {
                const humanPlayer = multiplayerConfig
                  ? game.players[multiplayerConfig.mySlot]
                  : game.players.find(p => p.isHuman);
                if (!humanPlayer) return null;
                const discardSelectedTotal = RESOURCES.reduce((s, r) => s + (discardSelection[r] || 0), 0);
                const remaining = humanDiscardPending.toDiscard - discardSelectedTotal;
                const canConfirm = discardSelectedTotal === humanDiscardPending.toDiscard;
                return (
                  <div style={{ padding: '16px', background: 'linear-gradient(135deg, #3a1a08, #2a1008)', border: '1px solid #6b4a18', borderRadius: '10px', marginBottom: '10px' }}>
                    <div style={{ marginBottom: '12px', fontWeight: 'bold', color: '#d4a020', fontSize: '0.95rem', textAlign: 'center' }}>
                      Discard {humanDiscardPending.toDiscard} of {getTotalResources(humanPlayer)} cards
                      {remaining > 0 && <span style={{ color: '#d2b48c', fontWeight: 'normal', marginLeft: '8px', fontSize: '0.85rem' }}>({remaining} more)</span>}
                    </div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center', marginBottom: '14px' }}>
                      {RESOURCES.map(r => {
                        const have = humanPlayer.resources[r] || 0;
                        const selected = discardSelection[r] || 0;
                        if (have === 0) return null;
                        const canAdd = selected < have && discardSelectedTotal < humanDiscardPending.toDiscard;
                        return (
                          <div
                            key={r}
                            onClick={() => {
                              if (canAdd) {
                                setDiscardSelection(prev => ({ ...prev, [r]: (prev[r] || 0) + 1 }));
                              } else if (selected > 0) {
                                setDiscardSelection(prev => ({ ...prev, [r]: Math.max(0, (prev[r] || 0) - 1) }));
                              }
                            }}
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              gap: '2px',
                              background: selected > 0 ? 'rgba(139, 32, 32, 0.5)' : 'rgba(60, 40, 20, 0.6)',
                              border: `2px solid ${selected > 0 ? '#c0392b' : '#6b4a18'}`,
                              borderRadius: '10px',
                              padding: '10px 14px',
                              minWidth: '64px',
                              cursor: (canAdd || selected > 0) ? 'pointer' : 'default',
                              transition: 'all 0.15s ease',
                              transform: selected > 0 ? 'scale(1.05)' : 'scale(1)',
                              userSelect: 'none',
                            }}
                          >
                            <span style={{ fontSize: '1.5rem', lineHeight: 1 }}>{HEX_ICON[r]}</span>
                            <span style={{ fontSize: '0.7rem', color: '#9a8a6a' }}>{have}</span>
                            {selected > 0 && (
                              <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#ff9090', background: 'rgba(192, 57, 43, 0.4)', borderRadius: '4px', padding: '1px 6px', marginTop: '2px' }}>
                                −{selected}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <button
                      onClick={handleConfirmDiscard}
                      disabled={!canConfirm}
                      style={{
                        ...({} as React.CSSProperties),
                        display: 'block',
                        width: '100%',
                        padding: '10px 20px',
                        background: canConfirm ? 'linear-gradient(180deg, #c0392b, #8b2020)' : 'rgba(60, 40, 20, 0.5)',
                        color: canConfirm ? '#fff' : '#9a8a6a',
                        border: canConfirm ? '1px solid #e74c3c' : '1px solid #6b4a18',
                        borderRadius: '8px',
                        cursor: canConfirm ? 'pointer' : 'default',
                        fontWeight: 'bold',
                        fontSize: '0.95rem',
                        fontFamily: "'Georgia', 'Palatino', serif",
                        transition: 'all 0.2s ease',
                        boxShadow: canConfirm ? '0 2px 8px rgba(192, 57, 43, 0.4)' : 'none',
                      }}
                    >
                      Discard {humanDiscardPending.toDiscard} Cards
                    </button>
                  </div>
                );
              })()}

              {/* Robber prompt */}
              {robbingMode && isMyTurn && (
                <div style={{ padding: '12px', background: '#7b1a1a', borderRadius: '8px', marginBottom: '10px', textAlign: 'center' }}>
                  <strong>☠️ You rolled 7! Click any hex to move the robber.</strong>
                </div>
              )}

              {/* Steal selection */}
              {stealCandidates.length > 0 && (
                <div style={{ padding: '12px', background: '#2c3e50', borderRadius: '8px', marginBottom: '10px' }}>
                  <div style={{ marginBottom: '8px', fontWeight: 'bold' }}>🗡️ Steal from:</div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {stealCandidates.map(p => (
                      <button key={p.id} onClick={() => handleSteal(p.id)}
                        style={{ padding: '6px 14px', background: p.color, border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', color: '#000' }}>
                        {p.name} ({getTotalResources(p)} cards)
                      </button>
                    ))}
                    <button onClick={() => setStealCandidates([])}
                      style={{ padding: '6px 10px', background: '#555', border: 'none', borderRadius: '6px', cursor: 'pointer', color: '#fff' }}>
                      Skip
                    </button>
                  </div>
                </div>
              )}


              {/* Error message */}
              {buildError && (
                <div style={{ padding: '8px', background: '#c0392b', borderRadius: '6px', marginBottom: '10px', fontSize: '0.85rem', textAlign: 'center' }}>
                  ⚠️ {buildError}
                </div>
              )}

              {/* Building mode indicator */}
              {buildingMode && (
                <div style={{ padding: '10px', background: '#27ae60', borderRadius: '8px', marginBottom: '10px', textAlign: 'center' }}>
                  <strong>🏗️ Placing {buildingMode}</strong>
                  {roadBuildingRoadsLeft > 0 && (
                    <span> — Road Building: {roadBuildingRoadsLeft} free road{roadBuildingRoadsLeft > 1 ? 's' : ''} left</span>
                  )}
                  <br /><small>Click a highlighted spot — or the board to cancel</small>
                </div>
              )}



              {/* Resource hand */}
              {(() => {
                const humanPlayer = multiplayerConfig
                  ? game.players[multiplayerConfig.mySlot]
                  : game.players.find(p => p.isHuman);
                if (!humanPlayer) return null;
                return (
                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap', marginTop: '10px', padding: '8px', background: 'rgba(0,0,0,0.25)', borderRadius: '8px' }}>
                    {RESOURCES.map(res => (
                      <span key={res} style={{ fontSize: '0.95rem', color: '#ddd' }}>
                        {HEX_ICON[res]} {humanPlayer.resources[res] || 0}
                      </span>
                    ))}
                  </div>
                );
              })()}

              <button className="btn btn-secondary" onClick={handleEndTurn} disabled={!isMyTurn || mustMoveRobber || mustDiscard} style={{ marginTop: '10px' }}>
                End Turn
              </button>
            </>
          )}
        </div>}
      </div>

      {/* Game Log — hidden during normal gameplay */}
      {/* <div className="game-log">
        <h4>📜 Game Log</h4>
        <div className="log-entries">
          {game.log.slice(-10).map((entry, i) => (
            <div key={i} className="log-entry">
              <span className="log-turn">T{entry.turn}</span>
              <span className="log-player" style={{ color: game.players[entry.player]?.color }}>
                {game.players[entry.player]?.name}
              </span>
              <span className="log-action">{entry.action}</span>
            </div>
          ))}
        </div>
      </div> */}

      {/* Dice flash overlay */}
      {flashDice && (
        <div className="dice-flash-overlay">
          <div className="dice-flash-container">
            <div className="dice-flash-die">
              <DiceDots value={flashDice[0]} />
            </div>
            <div className="dice-flash-die">
              <DiceDots value={flashDice[1]} />
            </div>
          </div>
        </div>
      )}

      {/* Flying resource gain animations */}
      {flyingResources.length > 0 && flyingResources.map((gain, idx) => {
        const targetCard = playerCardRefs.current[gain.playerId];
        if (!targetCard) return null;
        const rect = targetCard.getBoundingClientRect();
        const targetX = rect.left + rect.width / 2;
        const targetY = rect.top + rect.height / 2;
        const startX = window.innerWidth / 2;
        const startY = window.innerHeight / 2;
        const icon = HEX_ICON[gain.resource] || '?';
        const delay = idx * 120; // stagger each one
        return (
          <div key={gain.id}
            className="resource-fly"
            style={{
              '--fly-start-x': `${startX}px`,
              '--fly-start-y': `${startY}px`,
              '--fly-end-x': `${targetX}px`,
              '--fly-end-y': `${targetY}px`,
              animationDelay: `${delay}ms`,
              color: game.players[gain.playerId]?.color,
            } as React.CSSProperties}
          >
            {icon}
          </div>
        );
      })}

      {/* Game Over overlay */}
      {game.winner !== null && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#1a2a3a', padding: '48px', borderRadius: '18px', textAlign: 'center', border: `3px solid ${game.players[game.winner].color}` }}>
            <div style={{ fontSize: '3rem', marginBottom: '8px' }}>🏆</div>
            <h2 style={{ fontSize: '2rem', color: game.players[game.winner].color, marginBottom: '8px' }}>
              {game.players[game.winner].name} wins!
            </h2>
            <p style={{ color: '#aaa', marginBottom: '24px' }}>
              {calculateVP(game.players[game.winner], game)} victory points
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
              <button className="btn btn-primary" onClick={handleNewGame}>
                🎲 Play Again
              </button>
              {onLeaveGame && (
                <button className="btn btn-secondary" onClick={onLeaveGame}>
                  ← Main Menu
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
