import React, { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { lmsClient, LmsServer, LmsPlayer, LmsPlayerStatus } from '@/lib/lmsClient';

const LMS_SERVER_KEY = '@soundstream_lms_server';
const LMS_PLAYER_KEY = '@soundstream_lms_player';

interface LmsContextType {
  server: LmsServer | null;
  isConnected: boolean;
  isConnecting: boolean;
  connectionError: string | null;
  players: LmsPlayer[];
  activePlayer: LmsPlayer | null;
  playerStatus: LmsPlayerStatus | null;
  isRefreshing: boolean;
  connect: (host: string, port?: number) => Promise<boolean>;
  disconnect: () => void;
  discoverServer: (host: string, port?: number) => Promise<LmsServer | null>;
  refreshPlayers: () => Promise<void>;
  setActivePlayer: (player: LmsPlayer) => void;
  refreshPlayerStatus: () => Promise<LmsPlayerStatus | null>;
}

const LmsContext = createContext<LmsContextType | undefined>(undefined);

export function LmsProvider({ children }: { children: ReactNode }) {
  const [server, setServer] = useState<LmsServer | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [players, setPlayers] = useState<LmsPlayer[]>([]);
  const [activePlayer, setActivePlayerState] = useState<LmsPlayer | null>(null);
  const [playerStatus, setPlayerStatus] = useState<LmsPlayerStatus | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  const statusPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    loadStoredConnection();
    return () => {
      if (statusPollRef.current) {
        clearInterval(statusPollRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (statusPollRef.current) {
      clearInterval(statusPollRef.current);
      statusPollRef.current = null;
    }

    if (isConnected && activePlayer) {
      refreshPlayerStatus();
      statusPollRef.current = setInterval(() => {
        refreshPlayerStatus();
      }, 5000);
    }

    return () => {
      if (statusPollRef.current) {
        clearInterval(statusPollRef.current);
      }
    };
  }, [isConnected, activePlayer?.id]);

  const loadStoredConnection = async () => {
    try {
      const storedServer = await AsyncStorage.getItem(LMS_SERVER_KEY);
      const storedPlayer = await AsyncStorage.getItem(LMS_PLAYER_KEY);

      if (storedServer) {
        const serverData: LmsServer = JSON.parse(storedServer);
        const connected = await connect(serverData.host, serverData.port);
        
        if (connected && storedPlayer) {
          const playerData: LmsPlayer = JSON.parse(storedPlayer);
          const currentPlayers = await lmsClient.getPlayers();
          const foundPlayer = currentPlayers.find(p => p.id === playerData.id);
          if (foundPlayer) {
            setActivePlayerState(foundPlayer);
          }
        }
      }
    } catch (error) {
      console.error('Failed to load stored LMS connection:', error);
    }
  };

  const connect = useCallback(async (host: string, port: number = 9000): Promise<boolean> => {
    setIsConnecting(true);
    setConnectionError(null);

    try {
      const discoveredServer = await lmsClient.discoverServer(host, port);
      
      if (discoveredServer) {
        lmsClient.setServer(host, port);
        setServer(discoveredServer);
        setIsConnected(true);
        
        await AsyncStorage.setItem(LMS_SERVER_KEY, JSON.stringify(discoveredServer));
        
        await refreshPlayers();
        
        setIsConnecting(false);
        return true;
      } else {
        setConnectionError('Could not connect to LMS server. Make sure it is running.');
        setIsConnecting(false);
        return false;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown connection error';
      setConnectionError(errorMessage);
      setIsConnecting(false);
      return false;
    }
  }, []);

  const disconnect = useCallback(() => {
    setServer(null);
    setIsConnected(false);
    setPlayers([]);
    setActivePlayerState(null);
    setPlayerStatus(null);
    setConnectionError(null);
    
    AsyncStorage.removeItem(LMS_SERVER_KEY);
    AsyncStorage.removeItem(LMS_PLAYER_KEY);
    
    if (statusPollRef.current) {
      clearInterval(statusPollRef.current);
      statusPollRef.current = null;
    }
  }, []);

  const discoverServer = useCallback(async (host: string, port: number = 9000): Promise<LmsServer | null> => {
    return lmsClient.discoverServer(host, port);
  }, []);

  const refreshPlayers = useCallback(async (): Promise<void> => {
    if (!isConnected && !server) return;
    
    setIsRefreshing(true);
    try {
      const fetchedPlayers = await lmsClient.getPlayers();
      setPlayers(fetchedPlayers);
      
      if (fetchedPlayers.length > 0 && !activePlayer) {
        const firstPlayer = fetchedPlayers[0];
        setActivePlayerState(firstPlayer);
        await AsyncStorage.setItem(LMS_PLAYER_KEY, JSON.stringify(firstPlayer));
      }
    } catch (error) {
      console.error('Failed to refresh players:', error);
    } finally {
      setIsRefreshing(false);
    }
  }, [isConnected, server, activePlayer]);

  const setActivePlayer = useCallback((player: LmsPlayer) => {
    setActivePlayerState(player);
    AsyncStorage.setItem(LMS_PLAYER_KEY, JSON.stringify(player));
  }, []);

  const refreshPlayerStatus = useCallback(async (): Promise<LmsPlayerStatus | null> => {
    if (!activePlayer) return null;

    try {
      const status = await lmsClient.getPlayerStatus(activePlayer.id);
      setPlayerStatus(status);
      return status;
    } catch (error) {
      console.error('Failed to refresh player status:', error);
      return null;
    }
  }, [activePlayer]);

  return (
    <LmsContext.Provider
      value={{
        server,
        isConnected,
        isConnecting,
        connectionError,
        players,
        activePlayer,
        playerStatus,
        isRefreshing,
        connect,
        disconnect,
        discoverServer,
        refreshPlayers,
        setActivePlayer,
        refreshPlayerStatus,
      }}
    >
      {children}
    </LmsContext.Provider>
  );
}

export function useLms(): LmsContextType {
  const context = useContext(LmsContext);
  if (context === undefined) {
    throw new Error('useLms must be used within a LmsProvider');
  }
  return context;
}

export default useLms;
