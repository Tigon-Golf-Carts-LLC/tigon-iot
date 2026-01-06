import * as logger from 'firebase-functions/logger';
import {onRequest} from 'firebase-functions/v2/https';
import {onDocumentCreated} from 'firebase-functions/v2/firestore';
import {onSchedule} from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';

admin.initializeApp();

const db = admin.firestore();
const auth = admin.auth();

export const onUserCreate = onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({error: 'Unauthorized'});
    return;
  }
  
  const token = authHeader.split('Bearer ')[1];
  
  try {
    const decodedToken = await auth.verifyIdToken(token);
    const uid = decodedToken.uid;
    const email = decodedToken.email;
    
    logger.info('Creating user document for:', email);
    
    if (!email || !email.endsWith('@tigongolfcarts.com')) {
      res.status(403).json({error: 'Only @tigongolfcarts.com email addresses are allowed'});
      return;
    }
    
    await db.collection('users').doc(uid).set({
      email: email,
      emailVerified: decodedToken.email_verified || false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastLogin: admin.firestore.FieldValue.serverTimestamp(),
      role: 'user'
    });
    
    logger.info('User document created successfully:', email);
    res.status(200).json({success: true, uid: uid});
  } catch (error) {
    logger.error('Error creating user document:', error);
    res.status(500).json({error: 'Failed to create user document'});
  }
});

export const onNotificationCreate = onDocumentCreated('notifications/{notificationId}', async (event) => {
  const snapshot = event.data;
  if (!snapshot) {
    logger.warn('No data associated with the event');
    return;
  }
  const notification = snapshot.data();
  const targetUserId = notification.targetUserId;
  logger.info('New notification created for user:', targetUserId);
  const devicesSnapshot = await db.collection('devices').where('userId', '==', targetUserId).where('deviceType', '==', 'master').where('isActive', '==', true).get();
  if (devicesSnapshot.empty) {
    logger.info('No active master devices found');
    return;
  }
  logger.info('Found master devices:', devicesSnapshot.size);
  const fcmTokens: string[] = [];
  devicesSnapshot.forEach((doc: any) => {
    const token = doc.data().fcmToken;
    if (token) {
      fcmTokens.push(token);
    }
  });
  if (fcmTokens.length === 0) {
    logger.info('No FCM tokens found');
    return;
  }
  const message = {
    notification: {
      title: 'TIGON IOT: ' + (notification.sourceDeviceName || 'Unknown Device'),
      body: notification.text ? notification.text.substring(0, 100) : 'New notification',
    },
    data: {
      notificationId: event.params.notificationId,
      sourceDeviceName: notification.sourceDeviceName || 'Unknown Device',
      timestamp: new Date().toISOString(),
    },
    tokens: fcmTokens,
  };
  try {
    const response = await admin.messaging().sendEachForMulticast(message);
    logger.info('Successfully sent messages:', response.successCount);
    return response;
  } catch (error) {
    logger.error('Error sending FCM:', error);
    throw error;
  }
});

export const validateEmailDomain = onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({error: 'Unauthorized'});
    return;
  }
  const token = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await auth.verifyIdToken(token);
    const email = decodedToken.email;
    if (!email || !email.endsWith('@tigongolfcarts.com')) {
      res.status(403).json({error: 'Only @tigongolfcarts.com email addresses are allowed'});
      return;
    }
    res.status(200).json({valid: true, email: email});
  } catch (error) {
    logger.error('Error verifying token:', error);
    res.status(401).json({error: 'Invalid token'});
  }
});

export const getLatestAppVersion = onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({error: 'Unauthorized'});
    return;
  }
  const token = authHeader.split('Bearer ')[1];
  try {
    await auth.verifyIdToken(token);
    const versionDoc = await db.collection('appVersions').doc('android').get();
    if (!versionDoc.exists) {
      res.status(404).json({error: 'Version info not found'});
      return;
    }
    res.status(200).json(versionDoc.data());
  } catch (error) {
    logger.error('Error getting version:', error);
    res.status(401).json({error: 'Invalid token'});
  }
});

export const cleanupOldNotifications = onSchedule({schedule: 'every 24 hours', timeZone: 'America/New_York'}, async (event) => {
  logger.info('Starting cleanup of old notifications');
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const snapshot = await db.collection('notifications').where('createdAt', '<', admin.firestore.Timestamp.fromDate(thirtyDaysAgo)).get();
  if (snapshot.empty) {
    logger.info('No old notifications to delete');
    return;
  }
  logger.info('Found old notifications:', snapshot.size);
  const batch = db.batch();
  snapshot.docs.forEach((doc: any) => {
    batch.delete(doc.ref);
  });
  await batch.commit();
  logger.info('Cleanup complete. Deleted:', snapshot.size);
  return;
});

export const updateLastLogin = onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({error: 'Unauthorized'});
    return;
  }
  const token = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await auth.verifyIdToken(token);
    const userId = decodedToken.uid;
    await db.collection('users').doc(userId).update({lastLogin: admin.firestore.FieldValue.serverTimestamp()});
    res.status(200).json({success: true});
  } catch (error) {
    logger.error('Error updating last login:', error);
    res.status(401).json({error: 'Invalid token'});
  }
});