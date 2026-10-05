WHO growth tables (LMS parameters) used by core.growth.who
==========================================================

Every number in the *.csv files here is copied, unchanged, from the official
WHO spreadsheets listed below (columns Day/Month, L, M, S). Nothing was
computed, rounded or filled in by us. Columns: sex (m/f), age, L, M, S.
"age" is days for *_2006_day.csv and completed months for *_2007_month.csv.

Downloaded 2026-10-05 from cdn.who.int (sha256 of the source xlsx in brackets).

1. WHO Child Growth Standards (2006), 0-5 years, "expanded tables" by day
   (z-scores), 0..1856 days, boys and girls:
   https://www.who.int/tools/child-growth-standards/standards
   - wfa_2006_day.csv  <- weight-for-age
     .../child-growth-standards/indicators/weight-for-age/expanded-tables/
       wfa-boys-zscore-expanded-tables.xlsx   [b5b4748c6bfa5230e2eddafa1767629c349178b08d457f400b59422b8bfef86c]
       wfa-girls-zscore-expanded-tables.xlsx  [ee3ae12cb96c6c5541cdf43665c03ce6c984f877859a183a5f6104eb06a49a6e]
   - hfa_2006_day.csv  <- length/height-for-age
     .../child-growth-standards/indicators/length-height-for-age/expandable-tables/
       lhfa-boys-zscore-expanded-tables.xlsx  [c4b1c9029ab9751a5f0888e32f35c7c0287a16d361885cf911ecf23b3f7f6b4f]
       lhfa-girls-zscore-expanded-tables.xlsx [6aa2876319449a6b1f4d825848128902114ff53c67b92b86a0c5140846013059]
   - bmi_2006_day.csv  <- BMI-for-age
     .../child-growth-standards/indicators/body-mass-index-for-age/expanded-tables/
       bfa-boys-zscore-expanded-tables.xlsx   [58dcb2abea0e04b1c4f8ad3511d05ec1bea03741f230ac127b93f929e4cc6fc8]
       bfa-girls-zscore-expanded-tables.xlsx  [d3817262a383cdd02553b004f1c6110527d30b729c70501d032e71caadc17529]
   (prefix: https://cdn.who.int/media/docs/default-source/child-growth/child-growth-standards/indicators/)

2. WHO Growth Reference 5-19 years (2007), by month (z-scores):
   https://www.who.int/tools/growth-reference-data-for-5to19-years
   - hfa_2007_month.csv  <- height-for-age, 61..228 months
       height-for-age-(5-19-years)/hfa-boys-z-who-2007-exp.xlsx   [d78fa8cafcab77dcb5f03d71506d92bdcb28f89c642816b6bb0eef466b007466]
       height-for-age-(5-19-years)/hfa-girls-z-who-2007-exp.xlsx  [df07ee16d3d2916569f1d869b7c874d7b880a41321d871215ed0254cb16679b3]
   - bmi_2007_month.csv  <- BMI-for-age, 61..228 months
       bmi-for-age-(5-19-years)/bmi-boys-z-who-2007-exp.xlsx      [0a60849673f34a06b8e2fe4defe5d00348de687b6c9fce0278f1525fff89eb6d]
       bmi-for-age-(5-19-years)/bmi-girls-z-who-2007-exp.xlsx     [66f5c6284b44579ad6135fc639f22c09e36fe5a695b04390377113f6a00deb72]
   - wfa_2007_month.csv  <- weight-for-age, 61..120 months (WHO publishes
     weight-for-age only up to 10 years; past that it is not an indicator)
       weight-for-age-(5-10-years)/hfa-boys-z-who-2007-exp_0ff9c43c-8cc0-4c23-9fc6-81290675e08b.xlsx  [a6ed0d9f3cfa209747afe49f7503b7cc24a1be6b6a8e7222e85a36b7850cb99f]
       weight-for-age-(5-10-years)/hfa-girls-z-who-2007-exp_7ea58763-36a2-436d-bef0-7fcfbadd2820.xlsx [d747e068fcef4238cbaf1c201dd7788f266d9903685f4495360614eed0153562]
       (WHO itself names these weight-for-age files "hfa-...": the columns
        are weight in kg, M = 18.5057 kg for boys at 61 months.)
   (prefix: https://cdn.who.int/media/docs/default-source/child-growth/growth-reference-5-19-years/)
   Computation method: same site, computation.pdf.

Licence / attribution
---------------------
The WHO growth standards and reference are published by the World Health
Organization for public use; WHO permits reproduction of this material for
non-commercial and clinical use with attribution. Attribution:
  WHO Multicentre Growth Reference Study Group. WHO Child Growth Standards:
  Length/height-for-age, weight-for-age, weight-for-length, weight-for-height
  and body mass index-for-age: Methods and development. Geneva: WHO, 2006.
  de Onis M, Onyango AW, Borghi E, Siyam A, Nishida C, Siekmann J.
  Development of a WHO growth reference for school-aged children and
  adolescents. Bull World Health Organ 2007;85:660-7.

Updating
--------
Do not edit values by hand. Re-download the xlsx files above and regenerate
the CSV from the L, M, S columns; tests in packages/core/tests/test_growth_who.py
check the result against WHO's own published SD columns.
