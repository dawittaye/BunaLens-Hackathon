insert into public.market_benchmarks(id,sample_type,ecx_style_grade,min_etb_per_feresula,max_etb_per_feresula,source_label,effective_date,is_demo,active) values
('demo-green-g1','green_bean','Grade 1',6200,6900,'BunaLens demonstration benchmark','2026-11-15',true,true),
('demo-green-g2','green_bean','Grade 2',5700,6199,'BunaLens demonstration benchmark','2026-11-15',true,true),
('demo-green-g3','green_bean','Grade 3',4850,5699,'BunaLens demonstration benchmark','2026-11-15',true,true),
('demo-green-g4','green_bean','Grade 4',4200,4849,'BunaLens demonstration benchmark','2026-11-15',true,true),
('demo-green-u','green_bean','Undergrade',2500,4199,'BunaLens demonstration benchmark','2026-11-15',true,true),
('demo-cherry-g1','red_cherry','Grade 1',4200,5600,'BunaLens demonstration benchmark','2026-11-15',true,true),
('demo-cherry-g2','red_cherry','Grade 2',3600,4199,'BunaLens demonstration benchmark','2026-11-15',true,true),
('demo-cherry-g3','red_cherry','Grade 3',3000,3599,'BunaLens demonstration benchmark','2026-11-15',true,true),
('demo-cherry-g4','red_cherry','Grade 4',2400,2999,'BunaLens demonstration benchmark','2026-11-15',true,true),
('demo-cherry-u','red_cherry','Undergrade',1500,2399,'BunaLens demonstration benchmark','2026-11-15',true,true)
on conflict(id) do nothing;
