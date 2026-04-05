import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, Alert, Share, ActivityIndicator, Linking, StatusBar
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import MapView, { Marker, Circle, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, onValue, push, get } from 'firebase/database';

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);

const uploadLocation = async (deviceId, lat, lng, accuracy, nickname) => {
  try {
    await set(ref(db, `locations/${deviceId}/current`), {
      latitude: lat, longitude: lng, accuracy: accuracy || 0,
      timestamp: new Date().toISOString(), nickname: nickname || deviceId
    });
    await push(ref(db, `locations/${deviceId}/history`), {
      lat, lng, time: new Date().toISOString()
    });
  } catch (e) { console.log('Upload error:', e); }
};

const watchDeviceLocation = (deviceId, callback) => {
  const r = ref(db, `locations/${deviceId}/current`);
  return onValue(r, (snap) => { if (snap.exists()) callback(snap.val()); });
};

const getHistory = async (deviceId) => {
  const snap = await get(ref(db, `locations/${deviceId}/history`));
  if (!snap.exists()) return [];
  return Object.values(snap.val()).reverse().slice(0, 50);
};

const TASK_NAME = 'PH_LOCATION_TASK';

TaskManager.defineTask(TASK_NAME, async ({ data, error }) => {
  if (error || !data) return;
  const { locations } = data;
  const deviceId = await AsyncStorage.getItem('myDeviceId');
  const nickname = await AsyncStorage.getItem('myNickname');
  if (deviceId && locations[0]) {
    const { latitude, longitude, accuracy } = locations[0].coords;
    await uploadLocation(deviceId, latitude, longitude, accuracy, nickname);
  }
});

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false,
  }),
});

const genId = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
};

function HomeScreen({ navigation }) {
  const [myId, setMyId] = useState('--------');
  const [nickname, setNickname] = useState('');
  const [editNick, setEditNick] = useState(false);
  const [tempNick, setTempNick] = useState('');
  const [targetId, setTargetId] = useState('');
  const [isTracking, setIsTracking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [devices, setDevices] = useState([]);

  useEffect(() => {
    (async () => {
      let id = await AsyncStorage.getItem('myDeviceId');
      if (!id) { id = genId(); await AsyncStorage.setItem('myDeviceId', id); }
      const nick = await AsyncStorage.getItem('myNickname') || '';
      const devs = await AsyncStorage.getItem('trackedDevices');
      setMyId(id); setNickname(nick); setTempNick(nick);
      if (devs) setDevices(JSON.parse(devs));
      await Location.requestForegroundPermissionsAsync();
      await Location.requestBackgroundPermissionsAsync();
      await Notifications.requestPermissionsAsync();
    })();
  }, []);

  const startTracking = async () => {
    setLoading(true);
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      await uploadLocation(myId, loc.coords.latitude, loc.coords.longitude, loc.coords.accuracy, nickname);
      const started = await Location.hasStartedLocationUpdatesAsync(TASK_NAME).catch(() => false);
      if (!started) {
        await Location.startLocationUpdatesAsync(TASK_NAME, {
          accuracy: Location.Accuracy.High,
          timeInterval: 10000, distanceInterval: 5,
          showsBackgroundLocationIndicator: true,
          foregroundService: {
            notificationTitle: 'Ph Location',
            notificationBody: 'တည်နေရာ မျှဝေနေသည်...',
            notificationColor: '#00d4ff',
          },
        });
      }
      setIsTracking(true);
      Alert.alert('✅ စတင်ပြီ!', `သင်၏ ID:\n\n${myId}\n\nဤ ID ကို နောက်ဖုန်းတွင် ထည့်ပါ`);
    } catch (e) { Alert.alert('အမှား', e.message); }
    setLoading(false);
  };

  const stopTracking = async () => {
    const started = await Location.hasStartedLocationUpdatesAsync(TASK_NAME).catch(() => false);
    if (started) await Location.stopLocationUpdatesAsync(TASK_NAME);
    setIsTracking(false);
  };

  const saveNick = async () => {
    await AsyncStorage.setItem('myNickname', tempNick);
    setNickname(tempNick); setEditNick(false);
  };

  const addDevice = async () => {
    const id = targetId.trim().toUpperCase();
    if (id.length < 6) { Alert.alert('ID မှားနေသည်'); return; }
    if (devices.find(d => d.id === id)) { Alert.alert('ရှိပြီးသား'); return; }
    const updated = [...devices, { id, nickname: '' }];
    setDevices(updated);
    await AsyncStorage.setItem('trackedDevices', JSON.stringify(updated));
    setTargetId('');
  };

  const removeDevice = async (id) => {
    const updated = devices.filter(d => d.id !== id);
    setDevices(updated);
    await AsyncStorage.setItem('trackedDevices', JSON.stringify(updated));
  };

  const updateNick = async (id, nick) => {
    const updated = devices.map(d => d.id === id ? { ...d, nickname: nick } : d);
    setDevices(updated);
    await AsyncStorage.setItem('trackedDevices', JSON.stringify(updated));
  };

  return (
    <ScrollView style={s.bg}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0e1a" />
      <View style={s.logoWrap}>
        <Text style={s.logoPin}>📍</Text>
        <View>
          <Text style={s.logoTitle}>Ph Location</Text>
          <Text style={s.logoBy}>by ZawLinKhaing</Text>
        </View>
      </View>

      <View style={s.card}>
        <Text style={s.cardTitle}>📱 ကျွန်ုပ်ဖုန်း ID</Text>
        <View style={s.idRow}>
          <Text style={s.idText} selectable>{myId}</Text>
          <TouchableOpacity onPress={() => Share.share({ message: `Ph Location ID: ${myId}` })}>
            <Text style={s.shareIcon}>📤</Text>
          </TouchableOpacity>
        </View>
        <Text style={s.hint}>↑ ဤ ID ကို နောက်ဖုန်းတွင် ထည့်ပြီး တည်နေရာ ကြည့်နိုင်သည်</Text>
        {editNick ? (
          <View style={s.row}>
            <TextInput style={[s.input, { flex: 1 }]} value={tempNick} onChangeText={setTempNick}
              placeholder="ဖုန်းနာမည်" placeholderTextColor="#4a6080" />
            <TouchableOpacity style={s.smBtn} onPress={saveNick}>
              <Text style={s.smBtnTxt}>သိမ်း</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity onPress={() => setEditNick(true)}>
            <Text style={s.nickTxt}>✏️ {nickname || 'ဖုန်းနာမည် ထည့်ပါ'}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={[s.btn, isTracking ? s.btnRed : s.btnGreen]}
          onPress={isTracking ? stopTracking : startTracking} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> :
            <Text style={s.btnTxt}>{isTracking ? '⛔ မျှဝေခြင်း ရပ်မည်' : '📡 တည်နေရာ မျှဝေမည်'}</Text>}
        </TouchableOpacity>
      </View>

      <View style={s.card}>
        <Text style={s.cardTitle}>🔍 ဖုန်းတစ်လုံး ခြေရာခံမည်</Text>
        <TextInput style={s.input} value={targetId} onChangeText={setTargetId}
          placeholder="ပထမဖုန်း ID ထည့်ပါ" placeholderTextColor="#4a6080"
          autoCapitalize="characters" maxLength={8} />
        <TouchableOpacity style={[s.btn, s.btnBlue]} onPress={addDevice}>
          <Text style={s.btnTxt}>➕ ထည့်သွင်းမည်</Text>
        </TouchableOpacity>
      </View>

      {devices.map((dev, i) => (
        <DeviceCard key={i} device={dev} navigation={navigation}
          onRemove={() => removeDevice(dev.id)}
          onNickSave={(n) => updateNick(dev.id, n)} />
      ))}
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

function DeviceCard({ device, navigation, onRemove, onNickSave }) {
  const [loc, setLoc] = useState(null);
  const [editNick, setEditNick] = useState(false);
  const [nick, setNick] = useState(device.nickname || '');

  useEffect(() => {
    const unsub = watchDeviceLocation(device.id, setLoc);
    return () => unsub && unsub();
  }, []);

  const save = () => { onNickSave(nick); setEditNick(false); };

  return (
    <View style={s.devCard}>
      <View style={s.row}>
        <Text style={s.devId}>📱 {device.id}</Text>
        <TouchableOpacity onPress={onRemove}><Text style={s.removeBtn}>✕</Text></TouchableOpacity>
      </View>
      {editNick ? (
        <View style={s.row}>
          <TextInput style={[s.input, { flex: 1, marginTop: 8 }]} value={nick}
            onChangeText={setNick} placeholder="နာမည်ပေးပါ" placeholderTextColor="#4a6080" />
          <TouchableOpacity style={s.smBtn} onPress={save}><Text style={s.smBtnTxt}>သိမ်း</Text></TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity onPress={() => setEditNick(true)}>
          <Text style={s.nickTxt}>✏️ {device.nickname || 'နာမည်ပေးပါ'}</Text>
        </TouchableOpacity>
      )}
      {loc ? (
        <>
          <Text style={s.locTime}>🕐 {new Date(loc.timestamp).toLocaleTimeString('my-MM')}</Text>
          <TouchableOpacity style={[s.btn, s.btnBlue, { marginTop: 8 }]}
            onPress={() => navigation.navigate('မြေပုံ', { deviceId: device.id, nickname: device.nickname || device.id })}>
            <Text style={s.btnTxt}>🗺️ မြေပုံတွင် ကြည့်မည်</Text>
          </TouchableOpacity>
        </>
      ) : (
        <Text style={s.waitTxt}>⏳ တည်နေရာ စောင့်နေသည်...</Text>
      )}
    </View>
  );
}

function MapScreen({ route }) {
  const { deviceId, nickname } = route.params;
  const [loc, setLoc] = useState(null);
  const [prevLoc, setPrevLoc] = useState(null);
  const [trail, setTrail] = useState([]);
  const [lastTime, setLastTime] = useState('');
  const mapRef = useRef(null);

  useEffect(() => {
    const unsub = watchDeviceLocation(deviceId, (data) => {
      const coord = { latitude: data.latitude, longitude: data.longitude };
      if (prevLoc &&
        (Math.abs(prevLoc.latitude - coord.latitude) > 0.0001 ||
          Math.abs(prevLoc.longitude - coord.longitude) > 0.0001)) {
        Notifications.scheduleNotificationAsync({
          content: { title: `📍 ${nickname}`, body: 'တည်နေရာ ပြောင်းသွားပြီ' },
          trigger: null,
        });
      }
      setPrevLoc(coord);
      setLoc(data);
      setTrail(p => [...p.slice(-50), coord]);
      setLastTime(new Date().toLocaleTimeString('my-MM'));
      mapRef.current?.animateToRegion({ ...coord, latitudeDelta: 0.005, longitudeDelta: 0.005 }, 800);
    });
    return () => unsub && unsub();
  }, [prevLoc]);

  return (
    <View style={{ flex: 1, backgroundColor: '#0a0e1a' }}>
      <View style={s.mapHdr}>
        <Text style={s.mapTitle}>📍 {nickname || deviceId}</Text>
        <Text style={s.mapSub}>{lastTime ? `နောက်ဆုံးပြောင်း: ${lastTime}` : '⏳ စောင့်နေသည်...'}</Text>
      </View>
      {loc ? (
        <MapView ref={mapRef} provider={PROVIDER_GOOGLE} style={{ flex: 1 }}
          initialRegion={{ latitude: loc.latitude, longitude: loc.longitude, latitudeDelta: 0.005, longitudeDelta: 0.005 }}>
          <Marker coordinate={{ latitude: loc.latitude, longitude: loc.longitude }}>
            <View style={s.markerWrap}>
              <Text style={s.markerPin}>📱</Text>
              <Text style={s.markerLbl}>{nickname || deviceId}</Text>
            </View>
          </Marker>
          <Circle center={{ latitude: loc.latitude, longitude: loc.longitude }}
            radius={loc.accuracy || 20}
            fillColor="rgba(0,212,255,0.1)" strokeColor="rgba(0,212,255,0.4)" />
          {trail.length > 1 && <Polyline coordinates={trail} strokeColor="#00d4ff" strokeWidth={3} />}
        </MapView>
      ) : (
        <View style={s.center}><Text style={s.waitTxt}>⏳ တည်နေရာ ရှာဖွေနေသည်...</Text></View>
      )}
      <TouchableOpacity style={s.gmapBtn}
        onPress={() => loc && Linking.openURL(`https://maps.google.com/?q=${loc.latitude},${loc.longitude}`)}>
        <Text style={s.gmapTxt}>🗺️ Google Maps တွင် ဖွင့်မည်</Text>
      </TouchableOpacity>
      {loc && (
        <View style={s.infoBar}>
          <Text style={s.infoTxt}>Lat: {loc.latitude.toFixed(5)}</Text>
          <Text style={s.infoTxt}>Lng: {loc.longitude.toFixed(5)}</Text>
          <Text style={s.infoTxt}>တိကျမှု: {Math.round(loc.accuracy || 0)}m</Text>
        </View>
      )}
    </View>
  );
}

function HistoryScreen() {
  const [devices, setDevices] = useState([]);
  const [selected, setSelected] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem('trackedDevices').then(d => { if (d) setDevices(JSON.parse(d)); });
  }, []);

  const loadHistory = async (id) => {
    setSelected(id); setLoading(true);
    const h = await getHistory(id);
    setHistory(h); setLoading(false);
  };

  return (
    <ScrollView style={s.bg}>
      <View style={s.card}>
        <Text style={s.cardTitle}>📜 တည်နေရာ မှတ်တမ်း</Text>
        {devices.length === 0 ? <Text style={s.waitTxt}>ခြေရာခံသော ဖုန်း မရှိသေးပါ</Text> :
          devices.map((dev, i) => (
            <TouchableOpacity key={i} style={[s.btn, s.btnBlue, { marginBottom: 8 }]} onPress={() => loadHistory(dev.id)}>
              <Text style={s.btnTxt}>📱 {dev.nickname || dev.id}</Text>
            </TouchableOpacity>
          ))}
      </View>
      {loading && <ActivityIndicator color="#00d4ff" style={{ marginTop: 20 }} />}
      {selected && !loading && (
        <View style={s.card}>
          <Text style={s.cardTitle}>📍 {selected} မှတ်တမ်း</Text>
          {history.length === 0 ? <Text style={s.waitTxt}>မှတ်တမ်း မရှိသေးပါ</Text> :
            history.map((h, i) => (
              <TouchableOpacity key={i} style={s.histItem}
                onPress={() => Linking.openURL(`https://maps.google.com/?q=${h.lat},${h.lng}`)}>
                <Text style={s.histTime}>🕐 {new Date(h.time).toLocaleString('my-MM')}</Text>
                <Text style={s.histCoord}>📍 {h.lat.toFixed(5)}, {h.lng.toFixed(5)}</Text>
              </TouchableOpacity>
            ))}
        </View>
      )}
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

function FeedbackScreen() {
  const [msg, setMsg] = useState('');
  const send = async () => {
    if (!msg.trim()) { Alert.alert('အကြံပြုချက် ထည့်ပါ'); return; }
    try { await Linking.openURL('https://m.me/zawlinkhaing2025'); }
    catch { Alert.alert('Messenger မဖွင့်နိုင်ပါ'); }
  };
  return (
    <ScrollView style={s.bg}>
      <View style={s.card}>
        <Text style={s.cardTitle}>💬 အကြံပြုချက်</Text>
        <Text style={s.hint}>ZawLinKhaing ထံ တိုက်ရိုက် ပေးပို့နိုင်သည်</Text>
        <TextInput style={[s.input, { height: 140, textAlignVertical: 'top' }]}
          value={msg} onChangeText={setMsg} multiline numberOfLines={6}
          placeholder="အကြံပြုချက် ရေးပါ..." placeholderTextColor="#4a6080" />
        <TouchableOpacity style={[s.btn, { backgroundColor: '#0084ff' }]} onPress={send}>
          <Text style={s.btnTxt}>📨 Messenger တွင် ပေးပို့မည်</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => Linking.openURL('https://m.me/zawlinkhaing2025')}>
          <Text style={[s.hint, { color: '#00d4ff', textAlign: 'center', marginTop: 12 }]}>m.me/zawlinkhaing2025</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

function Tabs() {
  return (
    <Tab.Navigator screenOptions={{
      tabBarStyle: { backgroundColor: '#0d1b2e', borderTopColor: '#1e3a5f', height: 58 },
      tabBarActiveTintColor: '#00d4ff', tabBarInactiveTintColor: '#4a6080',
      headerStyle: { backgroundColor: '#0a0e1a' },
      headerTintColor: '#00d4ff', headerTitleStyle: { fontWeight: 'bold' },
      tabBarLabelStyle: { fontSize: 11, marginBottom: 4 },
    }}>
      <Tab.Screen name="ပင်မစာမျက်နှာ" component={HomeScreen}
        options={{ tabBarIcon: () => <Text style={{ fontSize: 20 }}>🏠</Text> }} />
      <Tab.Screen name="မှတ်တမ်း" component={HistoryScreen}
        options={{ tabBarIcon: () => <Text style={{ fontSize: 20 }}>📜</Text> }} />
      <Tab.Screen name="အကြံပြုချက်" component={FeedbackScreen}
        options={{ tabBarIcon: () => <Text style={{ fontSize: 20 }}>💬</Text> }} />
    </Tab.Navigator>
  );
}

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Home" component={Tabs} />
        <Stack.Screen name="မြေပုံ" component={MapScreen}
          options={{ headerShown: true, headerStyle: { backgroundColor: '#0a0e1a' }, headerTintColor: '#00d4ff' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const s = StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#0a0e1a' },
  logoWrap: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 20, paddingBottom: 10 },
  logoPin: { fontSize: 40 },
  logoTitle: { fontSize: 26, fontWeight: 'bold', color: '#00d4ff' },
  logoBy: { fontSize: 12, color: '#4a6080' },
  card: { backgroundColor: '#111827', borderWidth: 1, borderColor: '#1e3a5f', borderRadius: 12, padding: 18, margin: 14, marginBottom: 0 },
  cardTitle: { fontSize: 16, fontWeight: 'bold', color: '#00d4ff', marginBottom: 14 },
  idRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#0a1628', borderRadius: 10, padding: 14, marginBottom: 8 },
  idText: { fontSize: 24, fontWeight: 'bold', color: '#fff', letterSpacing: 4 },
  shareIcon: { fontSize: 24 },
  hint: { fontSize: 12, color: '#4a6080', marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { backgroundColor: '#0d1b2e', borderWidth: 1, borderColor: '#1e3a5f', borderRadius: 8, color: '#e2e8f0', padding: 12, fontSize: 14, marginBottom: 10 },
  nickTxt: { color: '#7dd3fc', fontSize: 13, marginBottom: 10 },
  btn: { borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 4 },
  btnTxt: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  btnGreen: { backgroundColor: '#16a34a' },
  btnRed: { backgroundColor: '#dc2626' },
  btnBlue: { backgroundColor: '#1d4ed8' },
  smBtn: { backgroundColor: '#1d4ed8', borderRadius: 8, padding: 10, marginLeft: 6 },
  smBtnTxt: { color: '#fff', fontWeight: 'bold', fontSize: 13 },
  devCard: { backgroundColor: '#1a2235', borderWidth: 1, borderColor: '#1e3a5f', borderRadius: 10, padding: 14, margin: 14, marginBottom: 0 },
  devId: { fontSize: 15, fontWeight: 'bold', color: '#e2e8f0' },
  removeBtn: { color: '#ef4444', fontSize: 18, fontWeight: 'bold' },
  locTime: { fontSize: 12, color: '#4a6080', marginTop: 6 },
  waitTxt: { color: '#4a6080', fontSize: 13, marginTop: 8 },
  mapHdr: { padding: 14, backgroundColor: '#111827', borderBottomWidth: 1, borderBottomColor: '#1e3a5f' },
  mapTitle: { fontSize: 18, color: '#00d4ff', fontWeight: 'bold' },
  mapSub: { fontSize: 12, color: '#4a6080', marginTop: 2 },
  markerWrap: { alignItems: 'center' },
  markerPin: { fontSize: 28 },
  markerLbl: { backgroundColor: '#00d4ff', color: '#000', fontSize: 11, fontWeight: 'bold', paddingHorizontal: 6, borderRadius: 4, marginTop: 2 },
  gmapBtn: { backgroundColor: '#1e3a5f', padding: 14, alignItems: 'center' },
  gmapTxt: { color: '#00d4ff', fontWeight: 'bold', fontSize: 15 },
  infoBar: { flexDirection: 'row', justifyContent: 'space-around', padding: 10, backgroundColor: '#111827' },
  infoTxt: { color: '#4a6080', fontSize: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  histItem: { backgroundColor: '#0d1b2e', borderRadius: 8, padding: 12, marginBottom: 8 },
  histTime: { color: '#7dd3fc', fontSize: 12, marginBottom: 4 },
  histCoord: { color: '#4a6080', fontSize: 12 },
});
