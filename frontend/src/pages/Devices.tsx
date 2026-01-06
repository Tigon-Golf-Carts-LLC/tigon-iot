import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  IconButton,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Add as AddIcon,
  Smartphone as SmartphoneIcon,
} from '@mui/icons-material';
import { collection, query, where, onSnapshot, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useAuth } from '../context/AuthContext';
import DashboardLayout from '../components/Layout/DashboardLayout';
import { formatDistanceToNow } from 'date-fns';

interface Device {
  id: string;
  deviceName: string;
  deviceType: 'master' | 'worker';
  isActive: boolean;
  lastActive: any;
  fcmToken?: string;
  appVersion?: string;
}

const Devices: React.FC = () => {
  const { currentUser } = useAuth();
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [newDeviceName, setNewDeviceName] = useState('');

  useEffect(() => {
    if (!currentUser) return;

    const q = query(
      collection(db, 'devices'),
      where('userId', '==', currentUser.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const devs: Device[] = [];
      snapshot.forEach((doc) => {
        devs.push({ id: doc.id, ...doc.data() } as Device);
      });
      setDevices(devs);
      setLoading(false);
    }, (error) => {
      console.error('Error fetching devices:', error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser]);

  const handleEditDevice = (device: Device) => {
    setSelectedDevice(device);
    setNewDeviceName(device.deviceName);
    setEditDialogOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!selectedDevice || !newDeviceName.trim()) return;

    try {
      await updateDoc(doc(db, 'devices', selectedDevice.id), {
        deviceName: newDeviceName,
      });
      setEditDialogOpen(false);
      setSelectedDevice(null);
      setNewDeviceName('');
    } catch (error) {
      console.error('Error updating device:', error);
      alert('Failed to update device');
    }
  };

  const handleDeleteDevice = async (deviceId: string) => {
    if (!confirm('Are you sure you want to delete this device?')) return;

    try {
      await deleteDoc(doc(db, 'devices', deviceId));
    } catch (error) {
      console.error('Error deleting device:', error);
      alert('Failed to delete device');
    }
  };

  const getTimeAgo = (timestamp: any) => {
    if (!timestamp) return 'Never';
    try {
      const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      return formatDistanceToNow(date, { addSuffix: true });
    } catch {
      return 'Unknown';
    }
  };

  const getStatusColor = (lastActive: any) => {
    if (!lastActive) return 'error';
    try {
      const date = lastActive.toDate ? lastActive.toDate() : new Date(lastActive);
      const minutesAgo = (new Date().getTime() - date.getTime()) / 1000 / 60;
      if (minutesAgo < 5) return 'success';
      if (minutesAgo < 60) return 'warning';
      return 'error';
    } catch {
      return 'error';
    }
  };

  return (
    <DashboardLayout>
      <Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
          <Typography variant="h4" color="primary">
            Devices
          </Typography>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => alert('To add a device, install the TIGON IOT app and login')}
          >
            Add Device
          </Button>
        </Box>

        <Paper sx={{ p: 3 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6">
              Registered Devices ({devices.length})
            </Typography>
            <IconButton onClick={() => window.location.reload()}>
              <RefreshIcon />
            </IconButton>
          </Box>

          {loading ? (
            <Typography>Loading devices...</Typography>
          ) : devices.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 6 }}>
              <SmartphoneIcon sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }} />
              <Typography variant="h6" color="text.secondary" gutterBottom>
                No Devices Registered
              </Typography>
              <Typography variant="body2" color="text.secondary" paragraph>
                Download the TIGON IOT app and login to register your first device
              </Typography>
              <Button variant="contained" href="/download">
                Download App
              </Button>
            </Box>
          ) : (
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Device Name</TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Last Active</TableCell>
                    <TableCell>App Version</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {devices.map((device) => (
                    <TableRow key={device.id} hover>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <SmartphoneIcon color="primary" />
                          <Typography variant="body1" fontWeight={500}>
                            {device.deviceName}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={device.deviceType === 'master' ? 'Master' : 'Worker'}
                          color={device.deviceType === 'master' ? 'secondary' : 'primary'}
                          size="small"
                        />
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={device.isActive ? 'Active' : 'Inactive'}
                          color={getStatusColor(device.lastActive)}
                          size="small"
                        />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" color="text.secondary">
                          {getTimeAgo(device.lastActive)}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" color="text.secondary">
                          {device.appVersion || 'Unknown'}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <IconButton
                          size="small"
                          color="primary"
                          onClick={() => handleEditDevice(device)}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => handleDeleteDevice(device.id)}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Paper>

        <Dialog open={editDialogOpen} onClose={() => setEditDialogOpen(false)}>
          <DialogTitle>Edit Device Name</DialogTitle>
          <DialogContent>
            <TextField
              autoFocus
              margin="dense"
              label="Device Name"
              type="text"
              fullWidth
              value={newDeviceName}
              onChange={(e) => setNewDeviceName(e.target.value)}
              placeholder="e.g., Phone #001"
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setEditDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveEdit} variant="contained">Save</Button>
          </DialogActions>
        </Dialog>
      </Box>
    </DashboardLayout>
  );
};

export default Devices;