import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  Grid,
  Card,
  CardContent,
  Chip,
  IconButton,
  Button,
} from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  Refresh as RefreshIcon,
  Smartphone as SmartphoneIcon,
  Notifications as NotificationsIcon,
} from '@mui/icons-material';
import { collection, query, orderBy, limit, onSnapshot, updateDoc, doc, where } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useAuth } from '../context/AuthContext';
import DashboardLayout from '../components/Layout/DashboardLayout';
import { formatDistanceToNow } from 'date-fns';

interface Notification {
  id: string;
  sourceDeviceName: string;
  text: string;
  timestamp: any;
  isHandled: boolean;
  createdAt: any;
}

const Dashboard: React.FC = () => {
  const { currentUser } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ total: 0, unhandled: 0, handled: 0 });

  useEffect(() => {
    if (!currentUser) return;

    // Real-time listener for notifications
    const q = query(
      collection(db, 'notifications'),
      where('targetUserId', '==', currentUser.uid),
      orderBy('createdAt', 'desc'),
      limit(20)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const notifs: Notification[] = [];
      snapshot.forEach((doc) => {
        notifs.push({ id: doc.id, ...doc.data() } as Notification);
      });
      setNotifications(notifs);
      
      // Calculate stats
      const unhandled = notifs.filter(n => !n.isHandled).length;
      const handled = notifs.filter(n => n.isHandled).length;
      setStats({ total: notifs.length, unhandled, handled });
      
      setLoading(false);
    }, (error) => {
      console.error('Error fetching notifications:', error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser]);

  const handleMarkAsHandled = async (notificationId: string) => {
    try {
      await updateDoc(doc(db, 'notifications', notificationId), {
        isHandled: true,
        handledAt: new Date(),
      });
    } catch (error) {
      console.error('Error updating notification:', error);
    }
  };

  const getTimeAgo = (timestamp: any) => {
    if (!timestamp) return 'Unknown time';
    try {
      const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      return formatDistanceToNow(date, { addSuffix: true });
    } catch {
      return 'Unknown time';
    }
  };

  return (
    <DashboardLayout>
      <Box>
        <Typography variant="h4" gutterBottom color="primary" sx={{ mb: 3 }}>
          Dashboard
        </Typography>

        {/* Stats Cards */}
        <Grid container spacing={3} sx={{ mb: 4 }}>
          <Grid item xs={12} sm={4}>
            <Card sx={{ bgcolor: 'primary.light', color: 'white' }}>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Box>
                    <Typography variant="h3" sx={{ fontWeight: 600 }}>
                      {stats.total}
                    </Typography>
                    <Typography variant="body2">Total Notifications</Typography>
                  </Box>
                  <NotificationsIcon sx={{ fontSize: 48, opacity: 0.8 }} />
                </Box>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={4}>
            <Card sx={{ bgcolor: 'error.main', color: 'white' }}>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Box>
                    <Typography variant="h3" sx={{ fontWeight: 600 }}>
                      {stats.unhandled}
                    </Typography>
                    <Typography variant="body2">Unhandled</Typography>
                  </Box>
                  <SmartphoneIcon sx={{ fontSize: 48, opacity: 0.8 }} />
                </Box>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={4}>
            <Card sx={{ bgcolor: 'success.main', color: 'white' }}>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Box>
                    <Typography variant="h3" sx={{ fontWeight: 600 }}>
                      {stats.handled}
                    </Typography>
                    <Typography variant="body2">Handled</Typography>
                  </Box>
                  <CheckCircleIcon sx={{ fontSize: 48, opacity: 0.8 }} />
                </Box>
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* Notifications Feed */}
        <Paper sx={{ p: 3 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h5" color="primary">
              Recent Notifications
            </Typography>
            <IconButton onClick={() => window.location.reload()}>
              <RefreshIcon />
            </IconButton>
          </Box>

          {loading ? (
            <Typography>Loading notifications...</Typography>
          ) : notifications.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <NotificationsIcon sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }} />
              <Typography variant="h6" color="text.secondary">
                No notifications yet
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Notifications from your worker devices will appear here
              </Typography>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {notifications.map((notif) => (
                <Paper
                  key={notif.id}
                  elevation={2}
                  sx={{
                    p: 2,
                    borderLeft: notif.isHandled ? '4px solid #4caf50' : '4px solid #af1f31',
                    '&:hover': { boxShadow: 4 },
                  }}
                >
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <Box sx={{ flex: 1 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                        <Chip
                          label={notif.sourceDeviceName || 'Unknown Device'}
                          size="small"
                          color="primary"
                          icon={<SmartphoneIcon />}
                        />
                        <Chip
                          label={notif.isHandled ? 'Handled' : 'Unhandled'}
                          size="small"
                          color={notif.isHandled ? 'success' : 'error'}
                        />
                      </Box>
                      <Typography variant="body1" sx={{ mb: 1 }}>
                        {notif.text || 'No message'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {getTimeAgo(notif.createdAt)}
                      </Typography>
                    </Box>
                    {!notif.isHandled && (
                      <Button
                        size="small"
                        variant="outlined"
                        color="success"
                        startIcon={<CheckCircleIcon />}
                        onClick={() => handleMarkAsHandled(notif.id)}
                      >
                        Mark Handled
                      </Button>
                    )}
                  </Box>
                </Paper>
              ))}
            </Box>
          )}
        </Paper>
      </Box>
    </DashboardLayout>
  );
};

export default Dashboard;