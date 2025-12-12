import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Colors, Spacing, Typography } from '@/constants/theme';
import { debugLog } from '@/lib/debugLog';
import { lmsClient } from '@/lib/lmsClient';
import { useMusic } from '@/hooks/useMusic';
import { usePlayback } from '@/hooks/usePlayback';

type LogEntry = {
  timestamp: Date;
  type: 'info' | 'error' | 'request' | 'response';
  message: string;
  details?: string;
};

export default function DebugScreen() {
  const insets = useSafeAreaInsets();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [serverStatus, setServerStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [expandedLog, setExpandedLog] = useState<number | null>(null);
  
  const { activeServer, servers } = useMusic();
  const { players, activePlayer } = usePlayback();

  useEffect(() => {
    setLogs(debugLog.getLogs());
    const unsubscribe = debugLog.subscribe(setLogs);
    return unsubscribe;
  }, []);

  useEffect(() => {
    checkServerStatus();
  }, [activeServer]);

  const checkServerStatus = async () => {
    if (!activeServer) {
      setServerStatus('disconnected');
      return;
    }
    
    setServerStatus('checking');
    try {
      const status = await lmsClient.getServerStatus();
      if (status) {
        setServerStatus('connected');
        debugLog.info('LMS server connected', `${status.info} - ${status.playerCount} players`);
      } else {
        setServerStatus('disconnected');
      }
    } catch (error) {
      setServerStatus('disconnected');
      debugLog.error('LMS connection failed', String(error));
    }
  };

  const testLmsConnection = async () => {
    if (!activeServer) {
      debugLog.error('No server configured', 'Please add an LMS server in Settings');
      return;
    }
    
    debugLog.info('Testing LMS connection...', `${activeServer.host}:${activeServer.port}`);
    
    try {
      const status = await lmsClient.getServerStatus();
      debugLog.response('LMS Server Status', JSON.stringify(status, null, 2));
    } catch (error) {
      debugLog.error('LMS test failed', String(error));
    }
  };

  const testGetPlayers = async () => {
    debugLog.info('Fetching LMS players...');
    
    try {
      const fetchedPlayers = await lmsClient.getPlayers();
      debugLog.response('Found players', `${fetchedPlayers.length} players:\n${fetchedPlayers.map(p => `- ${p.name} (${p.model})`).join('\n')}`);
    } catch (error) {
      debugLog.error('Get players failed', String(error));
    }
  };

  const testGetArtists = async () => {
    debugLog.info('Fetching artists from LMS...');
    
    try {
      const artists = await lmsClient.getArtists(0, 20);
      debugLog.response('Found artists', `${artists.length} artists:\n${artists.slice(0, 10).map(a => `- ${a.name}`).join('\n')}`);
    } catch (error) {
      debugLog.error('Get artists failed', String(error));
    }
  };

  const testGetAlbums = async () => {
    debugLog.info('Fetching albums from LMS...');
    
    try {
      const albums = await lmsClient.getAlbums(undefined, 0, 20);
      debugLog.response('Found albums', `${albums.length} albums:\n${albums.slice(0, 10).map(a => `- ${a.title} by ${a.artist}`).join('\n')}`);
    } catch (error) {
      debugLog.error('Get albums failed', String(error));
    }
  };

  const testPlayerStatus = async () => {
    if (!activePlayer) {
      debugLog.error('No player selected', 'Please select a player in Settings');
      return;
    }
    
    debugLog.info('Getting player status...', activePlayer.name);
    
    try {
      const status = await lmsClient.getPlayerStatus(activePlayer.id);
      debugLog.response('Player status', JSON.stringify({
        mode: status.mode,
        volume: status.volume,
        currentTrack: status.currentTrack?.title,
        playlistLength: status.playlist.length,
      }, null, 2));
    } catch (error) {
      debugLog.error('Get player status failed', String(error));
    }
  };

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await checkServerStatus();
    setIsRefreshing(false);
  }, []);

  const getLogColor = (type: LogEntry['type']) => {
    switch (type) {
      case 'error': return '#E53935';
      case 'request': return '#1E88E5';
      case 'response': return '#43A047';
      default: return Colors.light.textSecondary;
    }
  };

  const getLogIcon = (type: LogEntry['type']): React.ComponentProps<typeof Feather>['name'] => {
    switch (type) {
      case 'error': return 'alert-circle';
      case 'request': return 'arrow-up-circle';
      case 'response': return 'arrow-down-circle';
      default: return 'info';
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { 
      hour12: false, 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit' 
    });
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Debug Console</Text>
        <Pressable onPress={() => debugLog.clear()} style={styles.clearButton}>
          <Feather name="trash-2" size={20} color={Colors.light.textSecondary} />
        </Pressable>
      </View>

      <View style={styles.statusCard}>
        <Text style={styles.statusLabel}>LMS Server Status</Text>
        <View style={styles.statusRow}>
          <View style={[
            styles.statusDot,
            serverStatus === 'connected' && styles.statusConnected,
            serverStatus === 'disconnected' && styles.statusDisconnected,
            serverStatus === 'checking' && styles.statusChecking,
          ]} />
          <Text style={styles.statusText}>
            {serverStatus === 'checking' ? 'Checking...' : 
             serverStatus === 'connected' ? 'Connected' : 'Disconnected'}
          </Text>
        </View>
        <Text style={styles.serverInfo} numberOfLines={1}>
          {activeServer ? `${activeServer.host}:${activeServer.port}` : 'No server configured'}
        </Text>
        {activePlayer ? (
          <Text style={styles.playerInfo} numberOfLines={1}>
            Player: {activePlayer.name}
          </Text>
        ) : null}
        
        <View style={styles.testButtonsGrid}>
          <View style={styles.testButtonsRow}>
            <Pressable style={styles.testButton} onPress={testLmsConnection}>
              <Text style={styles.testButtonText}>Test Server</Text>
            </Pressable>
            <Pressable style={styles.testButton} onPress={testGetPlayers}>
              <Text style={styles.testButtonText}>Get Players</Text>
            </Pressable>
          </View>
          <View style={styles.testButtonsRow}>
            <Pressable style={styles.testButton} onPress={testGetArtists}>
              <Text style={styles.testButtonText}>Get Artists</Text>
            </Pressable>
            <Pressable style={styles.testButton} onPress={testGetAlbums}>
              <Text style={styles.testButtonText}>Get Albums</Text>
            </Pressable>
          </View>
          <View style={styles.testButtonsRow}>
            <Pressable style={styles.testButton} onPress={testPlayerStatus}>
              <Text style={styles.testButtonText}>Player Status</Text>
            </Pressable>
          </View>
        </View>
      </View>

      <ScrollView
        style={styles.logList}
        contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.xl }}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
        }
      >
        {logs.length === 0 ? (
          <Text style={styles.emptyText}>No logs yet. Interact with the app to see activity.</Text>
        ) : (
          logs.map((log, index) => (
            <Pressable
              key={index}
              style={styles.logEntry}
              onPress={() => setExpandedLog(expandedLog === index ? null : index)}
            >
              <View style={styles.logHeader}>
                <Feather name={getLogIcon(log.type)} size={16} color={getLogColor(log.type)} />
                <Text style={styles.logTime}>{formatTime(log.timestamp)}</Text>
                <Text style={[styles.logMessage, { color: getLogColor(log.type) }]} numberOfLines={expandedLog === index ? undefined : 1}>
                  {log.message}
                </Text>
              </View>
              {log.details && expandedLog === index ? (
                <Text style={styles.logDetails}>{log.details}</Text>
              ) : null}
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.backgroundRoot,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.light.border,
  },
  title: {
    ...Typography.title,
    color: Colors.light.text,
  },
  clearButton: {
    padding: Spacing.sm,
  },
  statusCard: {
    margin: Spacing.lg,
    padding: Spacing.lg,
    backgroundColor: Colors.light.backgroundSecondary,
    borderRadius: 12,
  },
  statusLabel: {
    ...Typography.caption,
    color: Colors.light.textSecondary,
    marginBottom: Spacing.sm,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: Spacing.sm,
    backgroundColor: Colors.light.textTertiary,
  },
  statusConnected: {
    backgroundColor: '#43A047',
  },
  statusDisconnected: {
    backgroundColor: '#E53935',
  },
  statusChecking: {
    backgroundColor: '#FFA000',
  },
  statusText: {
    ...Typography.body,
    color: Colors.light.text,
  },
  serverInfo: {
    ...Typography.caption,
    color: Colors.light.textSecondary,
    marginTop: Spacing.xs,
  },
  playerInfo: {
    ...Typography.caption,
    color: Colors.light.accent,
    marginTop: Spacing.xs,
  },
  testButtonsGrid: {
    marginTop: Spacing.lg,
    gap: Spacing.sm,
  },
  testButtonsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  testButton: {
    flex: 1,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.light.accent,
    borderRadius: 8,
    alignItems: 'center',
  },
  testButtonText: {
    ...Typography.caption,
    color: Colors.light.buttonText,
    fontWeight: '600',
  },
  logList: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
  },
  logEntry: {
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.light.border,
  },
  logHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  logTime: {
    ...Typography.label,
    color: Colors.light.textTertiary,
    minWidth: 60,
  },
  logMessage: {
    ...Typography.caption,
    flex: 1,
  },
  logDetails: {
    ...Typography.label,
    color: Colors.light.textSecondary,
    marginTop: Spacing.sm,
    marginLeft: 24 + Spacing.sm + 60,
    fontFamily: 'monospace',
  },
  emptyText: {
    ...Typography.body,
    color: Colors.light.textSecondary,
    textAlign: 'center',
    marginTop: Spacing["2xl"],
  },
});
