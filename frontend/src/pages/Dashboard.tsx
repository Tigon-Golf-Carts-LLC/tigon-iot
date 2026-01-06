import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Container,
  Typography,
  Button,
  Paper,
  AppBar,
  Toolbar,
} from '@mui/material';
import { useAuth } from '../context/AuthContext';

const Dashboard: React.FC = () => {
  const { currentUser, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
    } catch (error) {
      console.error('Failed to log out', error);
    }
  };

  return (
    <Box sx={{ flexGrow: 1 }}>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            TIGON IOT Dashboard
          </Typography>
          <Typography variant="body1" sx={{ mr: 2 }}>
            {currentUser?.email}
          </Typography>
          <Button color="inherit" onClick={handleLogout}>
            Logout
          </Button>
        </Toolbar>
      </AppBar>

      <Container maxWidth="lg" sx={{ mt: 4 }}>
        <Paper sx={{ p: 4 }}>
          <Typography variant="h4" gutterBottom color="primary">
            Welcome to TIGON IOT! 🎉
          </Typography>
          <Typography variant="body1" paragraph>
            Your notification relay system is ready!
          </Typography>
          <Typography variant="body1" paragraph>
            Email: {currentUser?.email}
          </Typography>
          <Typography variant="body1" paragraph>
            Email Verified: {currentUser?.emailVerified ? '✅ Yes' : '❌ No'}
          </Typography>
          
          <Box sx={{ mt: 4 }}>
            <Typography variant="h5" gutterBottom>
              Next Steps:
            </Typography>
            <Typography variant="body1">
              • Full dashboard with real-time notifications (coming next!)
            </Typography>
            <Typography variant="body1">
              • Device management page
            </Typography>
            <Typography variant="body1">
              • Settings page
            </Typography>
            <Typography variant="body1">
              • Android app download page
            </Typography>
          </Box>
        </Paper>
      </Container>
    </Box>
  );
};

export default Dashboard;