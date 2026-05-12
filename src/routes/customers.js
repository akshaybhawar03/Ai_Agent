/**
 * Customer Routes - CRUD operations and CSV import
 */
const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const { supabaseAdmin } = require('../services/supabase');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// GET /api/customers - List customers with filters
router.get('/', async (req, res) => {
  try {
    const { status, search, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    let query = supabaseAdmin
      .from('customers')
      .select('*', { count: 'exact' })
      .eq('business_id', req.businessId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    if (search) {
      query = query.or(`customer_name.ilike.%${search}%,phone.ilike.%${search}%`);
    }

    const { data, error, count } = await query;

    if (error) throw error;

    res.json({
      customers: data,
      total: count,
      page: parseInt(page),
      totalPages: Math.ceil(count / limit)
    });
  } catch (error) {
    console.error('Get customers error:', error);
    res.status(500).json({ error: 'Failed to fetch customers' });
  }
});

// POST /api/customers - Add a customer
router.post('/', async (req, res) => {
  try {
    const { customer_name, phone, amount_due, days_pending, items_given, status } = req.body;

    if (!customer_name || !phone || !amount_due) {
      return res.status(400).json({ error: 'Name, phone, and amount are required' });
    }

    const { data, error } = await supabaseAdmin
      .from('customers')
      .insert({
        business_id: req.businessId,
        customer_name,
        phone,
        amount_due: parseFloat(amount_due),
        days_pending: parseInt(days_pending) || 0,
        items_given: items_given || '',
        status: status || 'pending'
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    console.error('Create customer error:', error);
    res.status(500).json({ error: 'Failed to create customer' });
  }
});

// PUT /api/customers/:id - Update a customer
router.put('/:id', async (req, res) => {
  try {
    const allowedFields = [
      'customer_name', 'phone', 'amount_due', 'days_pending',
      'items_given', 'status', 'payment_promise_date', 'call_notes'
    ];

    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    const { data, error } = await supabaseAdmin
      .from('customers')
      .update(updates)
      .eq('id', req.params.id)
      .eq('business_id', req.businessId)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Update customer error:', error);
    res.status(500).json({ error: 'Failed to update customer' });
  }
});

// DELETE /api/customers/:id - Delete a customer
router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabaseAdmin
      .from('customers')
      .delete()
      .eq('id', req.params.id)
      .eq('business_id', req.businessId);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error('Delete customer error:', error);
    res.status(500).json({ error: 'Failed to delete customer' });
  }
});

// PATCH /api/customers/:id/status - Update customer status
router.patch('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pending', 'promised', 'paid', 'refused', 'callback', 'no_answer', 'wrong_number', 'dnc'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const { data, error } = await supabaseAdmin
      .from('customers')
      .update({ status })
      .eq('id', req.params.id)
      .eq('business_id', req.businessId)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Update status error:', error);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// POST /api/customers/import - Import from CSV
router.post('/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const csvContent = req.file.buffer.toString('utf-8');
    const columnMapping = req.body.mapping ? JSON.parse(req.body.mapping) : null;

    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });

    if (records.length === 0) {
      return res.status(400).json({ error: 'CSV file is empty' });
    }

    // Map columns
    const customers = records.map(record => {
      const mapped = {};

      if (columnMapping) {
        mapped.customer_name = record[columnMapping.customer_name] || '';
        mapped.phone = record[columnMapping.phone] || '';
        mapped.amount_due = parseFloat(record[columnMapping.amount_due]) || 0;
        mapped.days_pending = parseInt(record[columnMapping.days_pending]) || 0;
        mapped.items_given = record[columnMapping.items_given] || '';
      } else {
        // Auto-detect columns
        const keys = Object.keys(record);
        mapped.customer_name = record[keys.find(k => /name/i.test(k))] || record[keys[0]] || '';
        mapped.phone = record[keys.find(k => /phone|mobile|contact/i.test(k))] || record[keys[1]] || '';
        mapped.amount_due = parseFloat(record[keys.find(k => /amount|due|balance/i.test(k))] || record[keys[2]]) || 0;
        mapped.days_pending = parseInt(record[keys.find(k => /days|pending|overdue/i.test(k))] || record[keys[3]]) || 0;
        mapped.items_given = record[keys.find(k => /items|goods|product/i.test(k))] || record[keys[4]] || '';
      }

      return {
        business_id: req.businessId,
        ...mapped,
        status: 'pending'
      };
    }).filter(c => c.customer_name && c.phone && c.amount_due > 0);

    if (customers.length === 0) {
      return res.status(400).json({ error: 'No valid records found in CSV' });
    }

    const { data, error } = await supabaseAdmin
      .from('customers')
      .insert(customers)
      .select();

    if (error) throw error;

    res.json({
      imported: data.length,
      total: records.length,
      skipped: records.length - data.length
    });
  } catch (error) {
    console.error('Import error:', error);
    res.status(500).json({ error: 'Failed to import CSV: ' + error.message });
  }
});

module.exports = router;
