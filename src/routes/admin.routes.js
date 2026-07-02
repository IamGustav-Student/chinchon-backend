const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth.middleware');
const isAdmin = require('../middlewares/admin.middleware');
const c = require('../controllers/admin.controller');

router.use(auth, isAdmin);

router.get('/stats', c.getStats);

router.get('/users', c.getUsers);
router.post('/users/:id/ban', c.banUser);
router.post('/users/:id/unban', c.unbanUser);
router.put('/users/:id/balance', c.editBalance);
router.put('/users/:id/role', c.setRole);

router.get('/deposits', c.getDeposits);
router.post('/deposits/:id/approve', c.approveDeposit);
router.post('/deposits/:id/reject', c.rejectDeposit);

router.get('/tables', c.getTables);
router.delete('/tables/:id', c.closeTable);

router.get('/tournament', c.getTournament);
router.post('/tournament/start', c.startTournament);
router.post('/tournament/cancel', c.cancelTournament);

module.exports = router;
