import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

admin.initializeApp();

const db = admin.firestore();
const auth = admin.auth();

// ========================================
// 1. Validate Email Domain on User Creation
// ========================================
export const onUserCreate = functions.auth.user().onCreate(async (user) => {
  const email = user.email;
  
  console.log(`New user attempting to register: ${email}`);
  
  // Check if email ends with @tigongolfcarts.com
  if (!email || !email.endsWith('@tigongolfcarts.com')) {
    console.log(`Invalid email domain: ${email}. Deleting user.`);
    
    // Delete user if email is invalid
    await auth.deleteUser(user.uid);
    
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Only @tigongolfcarts.com email addresses are allowed'
    );
  }
  
  // Create user document in Firestore
  await db.collection('users').doc(user.uid).set({
    email: email,
    emailVerified: user.emailVerified,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    lastLogin: admin.firestore.FieldValue.serverTimestamp(),
    role: 'user'
  });
  
  console.log(`User created successfully: ${email}`);
  return null;
});

// ========================================
// 2. Send FCM Notification When New Notification Created
// ========================================
export const onNotificationCreate = functions.firestore
  .document('notifications/{notificationId}')
  .onCreate(async (snap, context) => {
    const notification = snap.data();
    const targetUserId = notification.targetUserId;
    
    console.log(`New notification created for user: ${targetUserId}`);
    
    // Get all active master devices for this user
    const devicesSnapshot = await db
      .collection('devices')
      .where('userId', '==', targetUserId)
      .where('deviceType', '==', 'master')
      .where('isActive', '==', true)
      .get();
    
    if (devicesSnapshot.empty) {
      console.log('No active master devices found');
      return null;
    }
    
    console.log(`Found ${devicesSnapshot.size} master device(s)`);
    
    // Collect FCM tokens
    const fcmTokens: string[] = [];
    devicesSnapshot.forEach(doc => {
      const token = doc.data().fcmToken;
      if (token) {
        fcmTokens.push(token);
        console.log(`Added FCM token for device: ${doc.id}`);
      }
    });
    
    if (fcmTokens.length === 0) {
      console.log('No FCM tokens found');
      return null;
    }
    
    // Prepare notification message
    const message = {
      notification: {
        title: `📱 ${notification.sourceDeviceName}`,
        body: notification.text ? notification.text.substring(0, 100) : 'New notification',
      },
      data: {
        notificationId: context.params.notificationId,
        sourceDeviceName: notification.sourceDeviceName || 'Unknown Device',
        timestamp: notification.timestamp?.toDate?.()?.toISOString() || new Date().toISOString(),
      },
      tokens: fcmTokens,
    };
    
    // Send notification
    try {
      const response = await admin.messaging().sendEachForMulticast(message);
      console.log(`Successfully sent ${response.successCount} message(s)`);
      
      if (response.failureCount > 0) {
        console.log(`Failed to send ${response.failureCount} message(s)`);
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            console.error(`Error sending to token ${idx}:`, resp.error);
          }
        });
      }
      
      return response;
    } catch (error) {
      console.error('Error sending FCM:', error);
      throw error;
    }
  });

// ========================================
// 3. Validate Email Domain (Callable Function)
// ========================================
export const validateEmailDomain = functions.https.onCall((data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'User must be authenticated'
    );
  }
  
  const email = context.auth.token.email;
  
  if (!email || !email.endsWith('@tigongolfcarts.com')) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Only @tigongolfcarts.com email addresses are allowed'
    );
  }
  
  return { 
    valid: true, 
    email: email 
  };
});

// ========================================
// 4. Get Latest App Version (Callable Function)
// ========================================
export const getLatestAppVersion = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'User must be authenticated'
    );
  }
  
  const versionDoc = await db
    .collection('appVersions')
    .doc('android')
    .get();
  
  if (!versionDoc.exists) {
    throw new functions.https.HttpsError(
      'not-found',
      'Version info not found'
    );
  }
  
  return versionDoc.data();
});

// ========================================
// 5. Clean Up Old Notifications (Scheduled - Daily)
// ========================================
export const cleanupOldNotifications = functions.pubsub
  .schedule('every 24 hours')
  .timeZone('America/New_York')
  .onRun(async (context) => {
    console.log('Starting cleanup of old notifications');
    
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const snapshot = await db
      .collection('notifications')
      .where('createdAt', '<', admin.firestore.Timestamp.fromDate(thirtyDaysAgo))
      .get();
    
    if (snapshot.empty) {
      console.log('No old notifications to delete');
      return null;
    }
    
    console.log(`Found ${snapshot.size} old notification(s) to delete`);
    
    // Delete in batches (Firestore limit is 500 per batch)
    const batchSize = 500;
    let deletedCount = 0;
    
    while (!snapshot.empty) {
      const batch = db.batch();
      const docsToDelete = snapshot.docs.slice(0, batchSize);
      
      docsToDelete.forEach(doc => {
        batch.delete(doc.ref);
      });
      
      await batch.commit();
      deletedCount += docsToDelete.length;
      
      console.log(`Deleted ${docsToDelete.length} notifications`);
      
      // Remove processed docs
      snapshot.docs.splice(0, batchSize);
    }
    
    console.log(`Cleanup complete. Total deleted: ${deletedCount}`);
    return null;
  });

// ========================================
// 6. Update User Last Login (Callable Function)
// ========================================
export const updateLastLogin = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'User must be authenticated'
    );
  }
  
  const userId = context.auth.uid;
  
  await db.collection('users').doc(userId).update({
    lastLogin: admin.firestore.FieldValue.serverTimestamp()
  });
  
  return { success: true };
});