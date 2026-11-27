ALTER TABLE support_tickets DROP CONSTRAINT IF EXISTS support_tickets_category_check;
ALTER TABLE support_tickets ADD CONSTRAINT support_tickets_category_check
 CHECK(category IN ('question','billing','invoice','bug','feedback','complaint'));
ALTER TABLE support_answers DROP CONSTRAINT IF EXISTS support_answers_category_check;
ALTER TABLE support_answers ADD CONSTRAINT support_answers_category_check
 CHECK(category IN ('question','billing','invoice','bug','feedback','complaint'));
