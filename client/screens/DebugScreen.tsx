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
import { browseContentDirectory, getTransportInfo } from '@/lib/upnpClient';
import AsyncStorage from '@react-native-async-storage/async-storage';

type LogEntry = {
  timestamp: Date;
  type: 'info' | 'error' | 'request' | 'response';
  message: string;
  details?: string;
};

export default function DebugScreen() {
  const insets = useSafeAreaInsets();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [bridgeStatus, setBridgeStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');
  const [bridgeUrl, setBridgeUrl] = useState<string>('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [expandedLog, setExpandedLog] = useState<number | null>(null);

  useEffect(() => {
    setLogs(debugLog.getLogs());
    const unsubscribe = debugLog.subscribe(setLogs);
    return unsubscribe;
  }, []);

  useEffect(() => {
    checkBridgeStatus();
  }, []);

  const checkBridgeStatus = async () => {
    setBridgeStatus('checking');
    try {
      const storedUrl = await AsyncStorage.getItem('@soundstream_bridge_url');
      setBridgeUrl(storedUrl || 'Not configured');
      
      if (storedUrl) {
        const response = await fetch(`${storedUrl}/health`, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
        });
        if (response.ok) {
          setBridgeStatus('connected');
          debugLog.info('Bridge health check passed', storedUrl);
        } else {
          setBridgeStatus('disconnected');
          debugLog.error('Bridge health check failed', `Status: ${response.status}`);
        }
      } else {
        setBridgeStatus('disconnected');
      }
    } catch (error) {
      setBridgeStatus('disconnected');
      debugLog.error('Bridge unreachable', String(error));
    }
  };

  const testMinimServer = async () => {
    debugLog.info('Testing MinimServer connection...');
    try {
      const url = 'http://192.168.0.19:9791/88f1207c-ffc2-4070-940e-ca5af99aa4d3/upnp.org-ContentDirectory-1/control';
      const result = await browseContentDirectory(url, '0', 'BrowseDirectChildren', 0, 10);
      debugLog.response('MinimServer responded', `Found ${result.items?.length || 0} items`);
    } catch (error) {
      debugLog.error('MinimServer test failed', String(error));
    }
  };

  const testVarese = async () => {
    debugLog.info('Testing Varese connection...');
    
    // Step 1: Raw HTTP test (no SOAP, no queue)
    try {
      debugLog.info('Step 1: Raw HTTP GET to Varese...');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
      
      const rawResponse = await fetch('http://192.168.0.42:16500/', {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      
      debugLog.response('Raw HTTP OK', `Status: ${rawResponse.status}`);
    } catch (rawError) {
      debugLog.error('Raw HTTP failed', String(rawError));
      debugLog.info('Varese not reachable at HTTP level - check WiFi/network');
      return; // Don't try SOAP if raw HTTP fails
    }
    
    // Step 2: SOAP test via queue
    try {
      debugLog.info('Step 2: SOAP GetTransportInfo...');
      const url = 'http://192.168.0.42:16500/Control/LibRygelRenderer/RygelAVTransport';
      const result = await getTransportInfo(url, 0);
      debugLog.response('Varese responded', `State: ${result.currentTransportState}`);
    } catch (error) {
      debugLog.error('Varese SOAP test failed', String(error));
    }
  };

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await checkBridgeStatus();
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

  const getLogIcon = (type: LogEntry['type']) => {
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
        <Text style={styles.statusLabel}>SSDP Bridge Status</Text>
        <View style={styles.statusRow}>
          <View style={[
            styles.statusDot,
            bridgeStatus === 'connected' && styles.statusConnected,
            bridgeStatus === 'disconnected' && styles.statusDisconnected,
            bridgeStatus === 'checking' && styles.statusChecking,
          ]} />
          <Text style={styles.statusText}>
            {bridgeStatus === 'checking' ? 'Checking...' : 
             bridgeStatus === 'connected' ? 'Connected' : 'Disconnected'}
          </Text>
        </View>
        <Text style={styles.bridgeUrl} numberOfLines={1}>{bridgeUrl}</Text>
        
        <View style={styles.testButtons}>
          <Pressable style={styles.testButton} onPress={testMinimServer}>
            <Text style={styles.testButtonText}>Test MinimServer</Text>
          </Pressable>
          <Pressable style={styles.testButton} onPress={testVarese}>
            <Text style={styles.testButtonText}>Test Varese</Text>
          </Pressable>
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
                <Feather 
                  name={getLogIcon(log.type) as any} 
                  size={16} 
                  color={getLogColor(log.type)} 
                />
                <Text style={[styles.logTime, { color: getLogColor(log.type) }]}>
                  {formatTime(log.timestamp)}
                </Text>
                <Text style={styles.logMessage} numberOfLines={expandedLog === index ? undefined : 1}>
                  {log.message}
                </Text>
              </View>
              {expandedLog === index && log.details && (
                <Text style={styles.logDetails}>{log.details}</Text>
              )}
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
  },
  title: {
    ...Typography.title,
    color: Colors.light.text,
  },
  clearButton: {
    padding: Spacing.sm,
  },
  statusCard: {
    backgroundColor: Colors.light.backgroundDefault,
    marginHorizontal: Spacing.lg,
    borderRadius: 12,
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  statusLabel: {
    ...Typography.caption,
    color: Colors.light.textSecondary,
    marginBottom: Spacing.xs,
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
  bridgeUrl: {
    ...Typography.caption,
    color: Colors.light.textSecondary,
    marginBottom: Spacing.md,
  },
  testButtons: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  testButton: {
    flex: 1,
    backgroundColor: Colors.light.accent,
    paddingVertical: Spacing.sm,
    borderRadius: 8,
    alignItems: 'center',
  },
  testButtonText: {
    ...Typography.caption,
    color: '#fff',
    fontWeight: '600',
  },
  logList: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
  },
  emptyText: {
    ...Typography.body,
    color: Colors.light.textSecondary,
    textAlign: 'center',
    marginTop: Spacing.xl,
  },
  logEntry: {
    backgroundColor: Colors.light.backgroundDefault,
    borderRadius: 8,
    padding: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  logHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  logTime: {
    ...Typography.caption,
    fontFamily: 'monospace',
    minWidth: 70,
  },
  logMessage: {
    ...Typography.caption,
    color: Colors.light.text,
    flex: 1,
  },
  logDetails: {
    ...Typography.caption,
    color: Colors.light.textSecondary,
    fontFamily: 'monospace',
    marginTop: Spacing.xs,
    paddingLeft: Spacing.lg,
    fontSize: 11,
  },
});
